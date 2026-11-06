import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@electric-sql/pglite"],
  // 关闭开发指示器角标，避免它出现在 README 的产品截图里（仅影响 dev 模式）。
  devIndicators: false,
};

export default nextConfig;
