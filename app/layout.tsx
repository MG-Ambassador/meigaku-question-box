import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "明学の質問箱 | 明治学院大学",
  description: "あなたの「気になる」を、イベントのきっかけに。匿名で参加できる明学の質問箱。",
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
      <body className="antialiased">{children}</body>
    </html>
  );
}
