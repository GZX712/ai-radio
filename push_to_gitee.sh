#!/bin/bash
# ===========================================
# AI 电台一键推送到 Gitee 脚本
# ===========================================
# 您只需要做一件事：在提示时粘贴令牌，按回车
# 其他全部自动完成
# ===========================================

echo "============================================"
echo "  AI 电台一键推送到 Gitee"
echo "  仓库：guan-zhixix/gzd678"
echo "============================================"
echo ""

# 第 1 步：让用户贴令牌（不显示，安全）
echo -n "请粘贴您的 Gitee 私人令牌（粘贴后按回车）："
read -rs TOKEN
echo ""

# 关键：剥掉所有空白字符（换行/回车/空格/Tab），避免 URL 拼接错误
TOKEN="$(echo "$TOKEN" | tr -d '\r\n \t')"

if [ -z "$TOKEN" ]; then
  echo "❌ 令牌为空，请重新运行"
  exit 1
fi

# 第 2 步：进入项目目录
cd "/c/Users/hxaka/WorkBuddy/2026-08-02-14-09-34/ai-radio" || {
  echo "❌ 找不到项目目录"
  exit 1
}
echo "✓ 已进入项目目录"

# 第 3 步：清理 Git 凭据缓存
printf "protocol=https\nhost=gitee.com\n" | git credential-manager erase >/dev/null 2>&1
echo "✓ 已清理缓存"

# 第 4 步：设置 git 用户（防止 Gitee 拒绝）
git config --global user.name "guan-zhixix" >/dev/null 2>&1
git config --global user.email "130539993+guan-zhixix@user.noreply.gitee.com" >/dev/null 2>&1
echo "✓ 已设置 git 用户"

# 第 5 步：用令牌组成 URL（避免弹窗）
git remote set-url origin "https://oauth2:${TOKEN}@gitee.com/guan-zhixix/gzd678.git"
echo "✓ 已设置远程仓库（含令牌）"

# 第 6 步：强制推送
echo ""
echo "🚀 开始推送（可能 5-10 秒）..."
echo "--------------------------------------------"
git push -u origin main --force
PUSH_RESULT=$?
echo "--------------------------------------------"

# 第 7 步：清掉 URL 中的令牌（防泄露到 .git/config）
git remote set-url origin "https://gitee.com/guan-zhixix/gzd678.git"
echo ""
echo "✓ 已清理 URL 中的令牌"

# 第 8 步：结果
echo ""
if [ $PUSH_RESULT -eq 0 ]; then
  echo "============================================"
  echo "  ✅ 推送成功！代码已传到 Gitee"
  echo "============================================"
  echo "  现在可以去 EdgeOne Pages 控制台绑仓库了"
else
  echo "============================================"
  echo "  ❌ 推送失败（错误代码：$PUSH_RESULT）"
  echo "============================================"
  echo "  常见原因："
  echo "  1. 令牌错误（不是 guan-zhixix 账号下生成的）"
  echo "  2. 仓库是私有但令牌没勾 projects 权限"
  echo "  3. 仓库地址错（实际仓库不在这个账号下）"
fi