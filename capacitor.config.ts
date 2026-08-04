import type { CapacitorConfig } from "@capacitor/cli";

const isDev = process.env.NODE_ENV === "development";
const devIp = process.env.VITE_DEV_SERVER_IP || "192.168.1.4"; // 改成你的局域网 IP

const config: CapacitorConfig = {
  appId: "com.workbuddy.airadio",
  appName: "AI 电台",
  webDir: "dist",
  server: isDev
    ? {
        androidScheme: "https",
        // 开发期：iPhone Safari 直接访问这台 Windows 的局域网 IP
        url: `http://${devIp}:5173`,
        cleartext: true,
      }
    : undefined,
  ios: {
    contentInset: "always",
    backgroundColor: "#0a0a0a",
    allowsLinkPreview: false,
  },
};

export default config;
