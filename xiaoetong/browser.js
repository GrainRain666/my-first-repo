/**
 * 小鹅通 - 网络请求调试版 v3
 * 监听所有页面（不限于新建的 page）
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CONFIG = {
  outputDir: path.join(__dirname, 'output'),
  userDataDir: path.join(__dirname, 'browser_profile'),
};

function waitForEnter(message) {
  return new Promise((resolve) => {
    console.log(`\n${message}`);
    process.stdin.once('data', () => resolve());
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║      🔍 网络请求调试模式 v3              ║');
  console.log('╚══════════════════════════════════════════╝');

  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  console.log('🚀 启动 Edge（监听所有页面）...\n');

  // launchPersistentContext 返回的是 BrowserContext
  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    channel: 'msedge',
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
    viewport: { width: 1280, height: 900 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });

  // ================================================================
  // 监听所有页面的网络请求（用 context 级别的事件）
  // ================================================================
  const allRequests = [];

  context.on('request', (request) => {
    const url = request.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    allRequests.push({
      type: 'request',
      url: url,
      method: request.method(),
      resourceType: request.resourceType(),
    });
  });

  context.on('response', (response) => {
    const url = response.url();
    if (url.startsWith('data:') || url.startsWith('blob:')) return;
    allRequests.push({
      type: 'response',
      url: url,
      status: response.status(),
      contentType: response.headers()['content-type'] || '',
    });
  });

  // 当新的 page 被创建时也监听
  context.on('page', (page) => {
    console.log(`  📄 检测到新页面: ${page.url() || '新标签页'}`);
    page.on('request', (request) => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      allRequests.push({
        type: 'request',
        url: url,
        method: request.method(),
        resourceType: request.resourceType(),
        pageUrl: page.url(),
      });
    });
    page.on('response', (response) => {
      const url = response.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      allRequests.push({
        type: 'response',
        url: url,
        status: response.status(),
        contentType: response.headers()['content-type'] || '',
        pageUrl: page.url(),
      });
    });
  });

  // 默认打开一个页面（方便用户操作）
  const mainPage = await context.newPage();
  console.log('  📄 已创建主页面\n');

  // ================================================================
  // 操作指引
  // ================================================================
  console.log('📌 请操作：');
  console.log('  1. 在打开的 Edge 中访问 study.xiaoe-tech.com 并登录');
  console.log('  2. 打开你的课程视频页面');
  console.log('  3. 点击播放视频（播放至少5秒）');
  console.log('');
  console.log('⏳ 正在监听所有页面网络请求...\n');

  await Promise.race([
    waitForEnter('按 Enter 停止记录...'),
    new Promise(r => setTimeout(r, 180000)),
  ]);

  // ================================================================
  // 分析结果
  // ================================================================
  console.log('\n══════════════════════════════════════════');
  console.log('📊 共记录 ' + allRequests.length + ' 个网络请求');
  console.log('══════════════════════════════════════════');

  // 所有请求的域名分布
  const domains = new Map();
  allRequests.forEach(r => {
    try {
      const domain = new URL(r.url).hostname;
      domains.set(domain, (domains.get(domain) || 0) + 1);
    } catch (e) {}
  });
  console.log('\n🌐 所有请求域名:');
  Array.from(domains.entries()).sort((a, b) => b[1] - a[1]).forEach(([d, c]) => {
    console.log(`  ${d}: ${c}请求`);
  });

  // 查找视频相关
  const videoResponses = allRequests.filter(r =>
    r.type === 'response' &&
    (r.contentType.match(/video\//i) ||
     r.contentType.match(/application\/vnd\.apple\.mpegurl/i) ||
     r.url.match(/\.m3u8/i) ||
     r.url.match(/\.mp4\b/i))
  );
  if (videoResponses.length > 0) {
    console.log('\n🎬 视频相关:');
    videoResponses.forEach(r => console.log(`  ${r.url.substring(0, 130)}`));
  } else {
    console.log('\n⚠️ 未发现视频请求');
  }

  // 查找含 "video" 或 "m3u8" 的 URL
  const mediaUrls = allRequests.filter(r =>
    r.url.match(/video|m3u8|stream|play|vod|media/i)
  );
  if (mediaUrls.length > 0) {
    console.log(`\n🎯 含 video/media 关键词的请求: ${mediaUrls.length}个`);
    mediaUrls.forEach(r => console.log(`  ${r.url.substring(0, 130)}`));
  }

  // 把所有 API 调用单独列出
  const apiCalls = allRequests.filter(r =>
    r.url.match(/\/api\/|\/v2\/|\/v3\/|\/v4\/|xiaoeknow|xet\./)
  );
  if (apiCalls.length > 0) {
    console.log(`\n📡 API 调用: ${apiCalls.length}个`);
    apiCalls.forEach(r => console.log(`  ${r.url.substring(0, 130)}`));
  } else if (allRequests.length > 0) {
    console.log('\n⚠️ 没有匹配到 API 调用，但捕捉到了其他请求');
    console.log('   看起来页面可能没有正确加载小鹅通');
  }

  // 保存
  const logFile = path.join(CONFIG.outputDir, 'network_debug.json');
  fs.writeFileSync(logFile, JSON.stringify(allRequests, null, 2), 'utf-8');
  console.log(`\n💾 已保存到: ${logFile}`);

  console.log('\n🔚 按 Enter 关闭浏览器...');
  await waitForEnter('');
  await context.close();
  console.log('👋 已关闭');
}

main().catch(err => {
  console.error('❌ 错误:', err.message);
  process.exit(1);
});
