package admin

import (
	"chat/channel"
	"chat/utils"
	"context"
	"database/sql"
	"fmt"
	"github.com/go-redis/redis/v8"
	"math"
	"strings"
	"time"
)

// AuthLike is to solve the problem of import cycle
type AuthLike struct {
	ID int64 `json:"id"`
}

func (a *AuthLike) GetID(_ *sql.DB) int64 {
	return a.ID
}

func (a *AuthLike) HitID() int64 {
	return a.ID
}

func getUsersForm(db *sql.DB, page int64, search string) PaginationForm {
	// if search is empty, then search all users

	var users []interface{}
	var total int64

	if err := db.QueryRow(`
		SELECT COUNT(*) FROM auth
		WHERE username LIKE ?
	`, "%"+search+"%").Scan(&total); err != nil {
		return PaginationForm{
			Status:  false,
			Message: err.Error(),
		}
	}

	rows, err := db.Query(`
		SELECT 
		    auth.id, auth.username, auth.email, auth.is_admin,
		    quota.quota, quota.used,
		    subscription.expired_at, subscription.total_month, subscription.enterprise, subscription.level,
		    auth.is_banned
		FROM auth
		LEFT JOIN quota ON quota.user_id = auth.id
		LEFT JOIN subscription ON subscription.user_id = auth.id
		WHERE auth.username LIKE ?
		ORDER BY auth.id LIMIT ? OFFSET ?
	`, "%"+search+"%", pagination, page*pagination)
	if err != nil {
		return PaginationForm{
			Status:  false,
			Message: err.Error(),
		}
	}

	for rows.Next() {
		var user UserData
		var (
			email             sql.NullString
			expired           []uint8
			quota             sql.NullFloat64
			usedQuota         sql.NullFloat64
			totalMonth        sql.NullInt64
			isEnterprise      sql.NullBool
			subscriptionLevel sql.NullInt64
			isBanned          sql.NullBool
		)
		if err := rows.Scan(&user.Id, &user.Username, &email, &user.IsAdmin, &quota, &usedQuota, &expired, &totalMonth, &isEnterprise, &subscriptionLevel, &isBanned); err != nil {
			return PaginationForm{
				Status:  false,
				Message: err.Error(),
			}
		}
		if email.Valid {
			user.Email = email.String
		}
		if quota.Valid {
			user.Quota = float32(quota.Float64)
		}
		if usedQuota.Valid {
			user.UsedQuota = float32(usedQuota.Float64)
		}
		if totalMonth.Valid {
			user.TotalMonth = totalMonth.Int64
		}
		if subscriptionLevel.Valid {
			user.Level = int(subscriptionLevel.Int64)
		}
		stamp := utils.ConvertTime(expired)
		if stamp != nil {
			user.IsSubscribed = stamp.After(time.Now())
		}
		user.Enterprise = isEnterprise.Valid && isEnterprise.Bool
		user.IsBanned = isBanned.Valid && isBanned.Bool

		users = append(users, user)
	}

	return PaginationForm{
		Status: true,
		Total:  int(math.Ceil(float64(total) / float64(pagination))),
		Data:   users,
	}
}

func passwordMigration(db *sql.DB, cache *redis.Client, id int64, password string) error {
	password = strings.TrimSpace(password)
	if len(password) < 6 || len(password) > 36 {
		return fmt.Errorf("password length must be between 6 and 36")
	}

	_, err := db.Exec(`
		UPDATE auth SET password = ? WHERE id = ?
	`, utils.Sha2Encrypt(password), id)

	cache.Del(context.Background(), fmt.Sprint("nio:user:root"))

	return err
}

func emailMigration(db *sql.DB, id int64, email string) error {
	_, err := db.Exec(`
		UPDATE auth SET email = ? WHERE id = ?
	`, email, id)

	return err
}

func quotaMigration(db *sql.DB, id int64, quota float32, override bool) error {
	// if quota is negative, then decrease quota
	// if quota is positive, then increase quota

	if override {
		_, err := db.Exec(`
			INSERT INTO quota (user_id, quota, used) VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE quota = ?
		`, id, quota, 0., quota)

		return err
	}

	_, err := db.Exec(`
		INSERT INTO quota (user_id, quota, used) VALUES (?, ?, ?) 
		ON DUPLICATE KEY UPDATE quota = quota + ?
	`, id, quota, 0., quota)

	return err
}

func subscriptionMigration(db *sql.DB, id int64, month int64) error {
	// if month is negative, then decrease month
	// if month is positive, then increase month

	expireAt := time.Now().AddDate(0, int(month), 0)

	_, err := db.Exec(`
		INSERT INTO subscription (user_id, total_month, expired_at) VALUES (?, ?, ?)
		ON DUPLICATE KEY UPDATE total_month = total_month + ?, expired_at = DATE_ADD(expired_at, INTERVAL ? MONTH)
	`, id, month, expireAt, month, month)

	return err
}

func subscriptionLevelMigration(db *sql.DB, id int64, level int64) error {
	if level < 0 || level > 3 {
		return fmt.Errorf("invalid subscription level")
	}

	_, err := db.Exec(`
		INSERT INTO subscription (user_id, level) VALUES (?, ?)
		ON DUPLICATE KEY UPDATE level = ?
	`, id, level, level)

	return err
}

func releaseUsage(db *sql.DB, cache *redis.Client, id int64) error {
	var level sql.NullInt64
	if err := db.QueryRow(`
		SELECT level FROM subscription WHERE user_id = ?
	`, id).Scan(&level); err != nil {
		return err
	}

	if !level.Valid || level.Int64 == 0 {
		return fmt.Errorf("user is not subscribed")
	}

	u := &AuthLike{ID: id}

	plan := channel.PlanInstance.GetPlan(int(level.Int64))
	if !plan.ReleaseAll(u, cache) {
		return fmt.Errorf("cannot release usage")
	}

	return nil
}

func UpdateRootPassword(db *sql.DB, cache *redis.Client, password string) error {
	password = strings.TrimSpace(password)
	if len(password) < 6 || len(password) > 36 {
		return fmt.Errorf("password length must be between 6 and 36")
	}

	if _, err := db.Exec(`
		UPDATE auth SET password = ? WHERE username = 'root'
	`, utils.Sha2Encrypt(password)); err != nil {
		return err
	}

	cache.Del(context.Background(), fmt.Sprint("nio:user:root"))

	return nil
}
