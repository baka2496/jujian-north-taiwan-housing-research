import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:5173";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const socialImage = protocol + "://" + host + "/og.png";

  return {
    title: "居鑑｜看屋前，先看懂取捨",
    description: "整合建案品質證據、建商售後、生活機能與環境風險的買房研究工具。",
    openGraph: {
      title: "居鑑｜看屋前，先看懂取捨",
      description: "設定買房底線，確認證據缺口，帶著問題去看屋。",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "居鑑北台灣建案履歷" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "居鑑｜看屋前，先看懂取捨",
      description: "設定買房底線，確認證據缺口，帶著問題去看屋。",
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* 2026-11 使用者覺得「太老套」：改用 Inter（數字、英文）＋ Noto Sans TC（中文），取代 Arial／微軟正黑體 */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
