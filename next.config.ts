import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server is opened at 127.0.0.1, which Next treats as a separate origin from localhost.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
