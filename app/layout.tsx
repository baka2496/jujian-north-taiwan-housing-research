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
      <body>{children}</body>
    </html>
  );
}
