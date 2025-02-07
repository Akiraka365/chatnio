import { LightAsync as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomOneDark as style } from "react-syntax-highlighter/dist/esm/styles/hljs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { parseFile } from "./plugins/file.tsx";
import "@/assets/markdown/all.less";
import { useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";
import { openDialog as openQuotaDialog } from "@/store/quota.ts";
import { openDialog as openSubscriptionDialog } from "@/store/subscription.ts";
import { AppDispatch } from "@/store";
import {
  Codepen,
  Codesandbox,
  Copy,
  Github,
  Maximize,
  RefreshCcwDot,
  Twitter,
  Wand2,
  Youtube,
} from "lucide-react";
import { copyClipboard } from "@/utils/dom.ts";
import { useToast } from "./ui/use-toast.ts";
import { useTranslation } from "react-i18next";
import { parseProgressbar } from "@/components/plugins/progress.tsx";
import { cn } from "@/components/ui/lib/utils.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { DialogClose } from "@radix-ui/react-dialog";
import { posterEvent } from "@/events/poster.ts";

type MarkdownProps = {
  children: string;
  className?: string;
  acceptHtml?: boolean;
  codeStyle?: string;
};

function doAction(dispatch: AppDispatch, url: string): boolean {
  if (url === "/subscribe") {
    dispatch(openSubscriptionDialog());
    return true;
  } else if (url === "/buy") {
    dispatch(openQuotaDialog());
    return true;
  }
  return false;
}

const LanguageMap: Record<string, string> = {
  html: "htmlbars",
  js: "javascript",
  ts: "typescript",
  jsx: "javascript",
  tsx: "typescript",
  rs: "rust",
};

function getSocialIcon(url: string) {
  try {
    const { hostname } = new URL(url);

    if (hostname.includes("github.com"))
      return <Github className="h-4 w-4 inline-block mr-0.5" />;
    if (hostname.includes("twitter.com"))
      return <Twitter className="h-4 w-4 inline-block mr-0.5" />;
    if (hostname.includes("youtube.com"))
      return <Youtube className="h-4 w-4 inline-block mr-0.5" />;
    if (hostname.includes("codepen.io"))
      return <Codepen className="h-4 w-4 inline-block mr-0.5" />;
    if (hostname.includes("codesandbox.io"))
      return <Codesandbox className="h-4 w-4 inline-block mr-0.5" />;
  } catch (e) {
    return;
  }
}

function getVirtualIcon(command: string) {
  switch (command) {
    case "/VARIATION":
      return <Wand2 className="h-4 w-4 inline-block mr-2" />;
    case "/UPSCALE":
      return <Maximize className="h-4 w-4 inline-block mr-2" />;
    case "/REROLL":
      return <RefreshCcwDot className="h-4 w-4 inline-block mr-2" />;
  }
}

function MarkdownContent({
  children,
  className,
  acceptHtml,
  codeStyle,
}: MarkdownProps) {
  const dispatch = useDispatch();
  const { t } = useTranslation();
  const { toast } = useToast();

  useEffect(() => {
    document.querySelectorAll(".file-instance").forEach((el) => {
      const parent = el.parentElement as HTMLElement;
      if (!parent.classList.contains("file-block"))
        parent.classList.add("file-block");
    });
  }, [children]);

  const rehypePlugins = useMemo(() => {
    const plugins = [rehypeKatex];
    return acceptHtml ? [...plugins, rehypeRaw] : plugins;
  }, [acceptHtml]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm, remarkBreaks]} // @ts-ignore
      rehypePlugins={rehypePlugins}
      className={cn("markdown-body", className)}
      children={children}
      skipHtml={!acceptHtml}
      components={{
        a({ href, children }) {
          const url: string = href?.toString() || "";

          if (url.startsWith("https://chatnio.virtual")) {
            const message = url.slice(23).replace(/-/g, " ");
            const prefix = message.split(" ")[0];
            const send = () => posterEvent.emit(message);

            return (
              <Dialog>
                <DialogTrigger asChild>
                  <Button
                    variant={`outline`}
                    className={`flex flex-row items-center virtual-action mx-1 my-0.5 min-w-[4rem]`}
                  >
                    {getVirtualIcon(prefix)}
                    {children}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("chat.send-message")}</DialogTitle>
                    <DialogDescription className={`pb-2`}>
                      {t("chat.send-message-desc")}
                    </DialogDescription>
                    <p className={`virtual-prompt`}>{message}</p>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant={`outline`}>{t("cancel")}</Button>
                    </DialogClose>
                    <DialogClose onClick={send} asChild>
                      <Button variant={`default`}>{t("confirm")}</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            );
          }

          return (
            <a
              href={url}
              target={`_blank`}
              rel={`noopener noreferrer`}
              onClick={(e) => {
                if (doAction(dispatch, url)) e.preventDefault();
              }}
            >
              {getSocialIcon(url)}
              {children}
            </a>
          );
        },
        code({ inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const language = match ? match[1].toLowerCase() : "";
          if (language === "file") return parseFile(children.toString());
          if (language === "progress")
            return parseProgressbar(children.toString());

          return !inline && match ? (
            <div className={`markdown-syntax`}>
              <div className={`markdown-syntax-header`}>
                <Copy
                  className={`h-3 w-3`}
                  onClick={async () => {
                    await copyClipboard(children.toString());
                    toast({
                      title: t("share.copied"),
                    });
                  }}
                />
                <p>{language}</p>
              </div>
              <SyntaxHighlighter
                {...props}
                children={String(children).replace(/\n$/, "")}
                style={style}
                language={LanguageMap[language] || language}
                PreTag="div"
                wrapLongLines={true}
                wrapLines={true}
                className={cn("code-block", codeStyle)}
              />
            </div>
          ) : (
            <code className={cn("code-inline", className)} {...props}>
              {children}
            </code>
          );
        },
      }}
    />
  );
}

function Markdown({ children, ...props }: MarkdownProps) {
  // memoize the component
  return useMemo(
    () => <MarkdownContent {...props}>{children}</MarkdownContent>,
    [props, children],
  );
}

type CodeMarkdownProps = MarkdownProps & {
  filename: string;
};

export function CodeMarkdown({ filename, ...props }: CodeMarkdownProps) {
  const suffix = filename.includes(".") ? filename.split(".").pop() : "";
  const children = useMemo(() => {
    const content = props.children.toString();

    return `\`\`\`${suffix}\n${content}\n\`\`\``;
  }, [props.children]);

  return <Markdown {...props}>{children}</Markdown>;
}

export default Markdown;
