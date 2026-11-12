import type { Metadata, Viewport } from "next";
import { SeasonTheme } from "@/components/question-box/season-theme";
import "./globals.css";

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#f7f5f0' };

export const metadata: Metadata = {
  title: "明学の質問箱 | 明治学院大学",
  description: "気になることを、イベントのきっかけに。匿名で参加できる明学の質問箱。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout applies to every page. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@300;400;500;700&display=swap"
        />
      </head>
      <body className="antialiased">
        <SeasonTheme />
        {children}
      </body>
    </html>
  );
}
