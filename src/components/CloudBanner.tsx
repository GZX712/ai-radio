import { useEffect, useState } from "react";
import type { NowPlaying } from "@/types";
import { isCloudDemo } from "@/lib/cloudMode";

interface CloudBannerProps {
  remoteNow: NowPlaying | null;
  remoteLastSeen: number;
}

/**
 * 云端模式顶部横幅：明确告诉用户这是 EdgeOne 部署版，需要电脑端开启本地服务才能播放
 * 远端电脑每 2.5s 推一次当前歌过来；轮询显示在横幅中（让辛老师知道是不是有人在电脑端播）
 */
export function CloudBanner({ remoteNow, remoteLastSeen }: CloudBannerProps) {
  // 默认不在云端 → 隐藏
  const [show, setShow] = useState(isCloudDemo());
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [age, setAge] = useState<number>(Infinity);

  useEffect(() => {
    if (!show) return;
    setNow(remoteNow);
  }, [remoteNow, show]);

  // 每秒更新"远端最近一次上报距今多少秒"
  useEffect(() => {
    if (!show) return;
    const t = window.setInterval(() => {
      if (remoteLastSeen > 0) setAge(Math.floor((Date.now() - remoteLastSeen) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [show, remoteLastSeen]);

  if (!show) return null;

  const isOnline = remoteNow && age < 30; // 30 秒内有上报 → 在线
  const localUrl =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:8787"
      : `http://${location.hostname}:8787`;

  return (
    <div className="cloud-banner" role="status">
      <div className="cloud-banner-main">
        <span className="cloud-banner-icon" aria-hidden>☁️</span>
        <div className="cloud-banner-text">
          <div className="cloud-banner-title">云端演示版</div>
          <div className="cloud-banner-sub">
            {isOnline
              ? "远端电脑正在播放（同步显示）"
              : "等待远端电脑开始播放…"}
          </div>
        </div>
        <a
          className="cloud-banner-cta"
          href={localUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="在同网络电脑/手机上访问完整版（含播放/DJ/聊天）"
        >
          🎧 打开完整版
        </a>
      </div>
      {isOnline && now && (
        <div className="cloud-banner-remote">
          <span className="cloud-banner-remote-pulse" />
          <span className="cloud-banner-remote-label">远端正在播</span>
          <strong className="cloud-banner-remote-name">{now.name}</strong>
          <span className="cloud-banner-remote-artist">— {now.artist}</span>
          <span className="cloud-banner-remote-age">· {age}s 前</span>
        </div>
      )}
    </div>
  );
}
