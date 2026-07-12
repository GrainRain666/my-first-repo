/**
 * 小鹅通课程 → 逐字稿 主流程脚本
 *
 * 用法:
 *   手动模式:  node run.js
 *   自动模式:  node run.js --url <课程页面URL>
 *
 * 流程:
 *   1. 启动浏览器 → 你扫码登录小鹅通
 *   2. 打开课程页面 → 提取视频链接
 *   3. 下载视频 → ffmpeg 提取音频
 *   4. faster-whisper GPU 转文字
 *   5. 输出逐字稿 .md 文件
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = __dirname;
const OUTPUT_DIR = path.join(ROOT, 'output');

// 确保输出目录存在
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer));
  });
}

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    ...opts,
  });
}

function runOutput(cmd) {
  return execSync(cmd, {
    cwd: ROOT,
    encoding: 'utf-8',
    shell: true,
  }).trim();
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     🎓 小鹅通课程 → 逐字稿                   ║');
  console.log('║     1. 浏览器提取                            ║');
  console.log('║     2. faster-whisper GPU 转写（~10倍加速）   ║');
  console.log('║     3. 自动生成逐字稿                        ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  // ==========================================================
  // 步骤 1: 通过浏览器获取视频
  // ==========================================================
  console.log('📌 步骤 1/4: 启动浏览器获取课程内容');
  console.log('──────────────────────────────────────────────');
  console.log('浏览器打开后，请:');
  console.log('  1. 扫码登录小鹅通');
  console.log('  2. 打开你想处理的课程视频页面');
  console.log('  3. 点击播放视频（让我们能捕获视频地址）');
  console.log('  4. 切换到本终端按 Enter 继续');
  console.log('');

  await ask('准备就绪后按 Enter 启动浏览器...');

  // 运行浏览器脚本（前置）
  console.log('\n🚀 正在启动浏览器...');
  run('node browser.js', { timeout: 0 });

  // browser.js 会保存 video_urls.json 到 output 目录
  // 等待用户手动运行后继续

  // ==========================================================
  // 步骤 2: 检查提取结果并处理
  // ==========================================================
  console.log('\n📌 步骤 2/4: 检查提取结果');
  console.log('──────────────────────────────────────────────');

  const videoUrlsFile = path.join(OUTPUT_DIR, 'video_urls.json');

  if (!fs.existsSync(videoUrlsFile)) {
    console.log('⚠️  未找到视频地址记录。');
    console.log('请选择处理方式:');
    console.log('  1. 我已经有了视频文件，直接转录');
    console.log('  2. 我找到了 m3u8 视频流地址，帮我下载');
    const choice = await ask('请选择 (1/2): ');

    if (choice === '1') {
      const videoPath = await ask('请输入视频文件完整路径: ');
      await transcribeVideo(videoPath.trim());
    } else if (choice === '2') {
      const m3u8Url = await ask('请输入 m3u8 地址: ');
      await downloadAndTranscribe(m3u8Url.trim());
    }
  } else {
    const data = JSON.parse(fs.readFileSync(videoUrlsFile, 'utf-8'));
    const urls = data.videoUrls;

    console.log(`\n📹 捕获到 ${urls.length} 个视频地址:\n`);
    urls.forEach((url, i) => {
      console.log(`  ${i + 1}. ${url.substring(0, 120)}...`);
    });

    console.log('\n选择处理方式:');
    console.log('  1. 用第一个视频地址下载并转录');
    console.log('  2. 指定本地视频文件转录');
    console.log('  3. 手动输入 m3u8 地址');
    const choice = await ask('请选择 (1/2/3): ');

    if (choice === '1' && urls.length > 0) {
      await downloadAndTranscribe(urls[0]);
    } else if (choice === '2') {
      const videoPath = await ask('请输入视频文件完整路径: ');
      await transcribeVideo(videoPath.trim());
    } else if (choice === '3') {
      const m3u8Url = await ask('请输入 m3u8 地址: ');
      await downloadAndTranscribe(m3u8Url.trim());
    }
  }

  rl.close();
  console.log('\n✅ 全部完成！逐字稿已生成到 output/ 目录');
}

/**
 * 下载视频（支持 m3u8）并转录
 */
async function downloadAndTranscribe(url) {
  console.log('\n📥 正在下载视频...');

  // 生成文件名
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputVideo = path.join(OUTPUT_DIR, `video_${timestamp}.mp4`);

  // 用 ffmpeg 下载
  const ffmpeg = `"${path.join(
    'C:/Users/William/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'ffmpeg-8.1.2-full_build/bin/ffmpeg.exe'
  )}"`;

  try {
    if (url.includes('.m3u8')) {
      console.log('  📺 检测到 m3u8 流媒体，使用 ffmpeg 下载...');
      run(`${ffmpeg} -y -i "${url}" -c copy -bsf:a aac_adtstoasc "${outputVideo}"`, { timeout: 600000 });
    } else {
      console.log('  📺 直接下载视频文件...');
      run(`${ffmpeg} -y -i "${url}" -c copy "${outputVideo}"`, { timeout: 600000 });
    }
    console.log('✅ 视频下载完成:', outputVideo);
    await transcribeVideo(outputVideo);
  } catch (err) {
    console.error('❌ 下载失败:', err.message);
    console.log('提示: m3u8 可能需要先手动在浏览器中播放缓存');
    const localPath = await ask('请手动下载视频后输入本地路径: ');
    if (localPath.trim()) {
      await transcribeVideo(localPath.trim());
    }
  }
}

/**
 * 转录视频文件
 */
async function transcribeVideo(videoPath) {
  if (!fs.existsSync(videoPath)) {
    console.error('❌ 文件不存在:', videoPath);
    return;
  }

  const videoName = path.basename(videoPath, path.extname(videoPath));
  const outputBase = path.join(OUTPUT_DIR, videoName);

  console.log('\n📌 步骤 3/4: 提取音频 + GPU 转文字');
  console.log('──────────────────────────────────────────────');
  console.log(`  🎬 视频: ${videoName}`);

  // 询问模型选择
  console.log('\n选择转录模型:');
  console.log('  1. small (~500MB, 快速, 推荐测试用)');
  console.log('  2. medium (~1.5GB, 平衡, 推荐日常用)');
  console.log('  3. large (~3GB, 最准, 适合重要课程)');
  const modelChoice = await ask('请选择 (1/2/3, 默认2): ') || '2';
  const modelMap = { '1': 'small', '2': 'medium', '3': 'large' };
  const model = modelMap[modelChoice] || 'medium';

  // 运行转录
  const python = `"${path.join(
    'C:/Users/William/AppData/Local/Programs/Python/Python311',
    'python.exe'
  )}"`;

  const transcribeScript = path.join(ROOT, 'transcribe.py');

  console.log(`\n🎯 模型: ${model} | 设备: cuda | 精度: int8_float16`);
  console.log('⏳ 开始转写，请稍候...\n');

  try {
    run(
      `${python} "${transcribeScript}" "${videoPath}" ` +
      `--model ${model} --device cuda --compute int8_float16 ` +
      `--language zh --output "${outputBase}"`,
      { timeout: 3600000 }  // 最长 1 小时
    );

    console.log('\n📌 步骤 4/4: 完成！');
    console.log('──────────────────────────────────────────────');
    console.log(`📁 所有文件已生成到: ${OUTPUT_DIR}/`);
    console.log(`   📄 ${videoName}-逐字稿.md  - 精美排版的逐字稿`);
    console.log(`   📄 ${videoName}.srt        - SRT 字幕文件`);
    console.log(`   📄 ${videoName}.txt        - 纯文本`);

  } catch (err) {
    console.error('❌ 转写失败:', err.message);
    // 尝试降级到 CPU
    console.log('\n⚠️ GPU 转写失败，尝试 CPU 模式...');
    try {
      run(
        `${python} "${transcribeScript}" "${videoPath}" ` +
        `--model ${model} --device cpu --compute int8 ` +
        `--language zh --output "${outputBase}"`,
        { timeout: 3600000 }
      );
      console.log('✅ CPU 转写完成！(速度较慢，但结果一样)');
    } catch (err2) {
      console.error('❌ CPU 转写也失败:', err2.message);
    }
  }
}

main().catch(console.error);
