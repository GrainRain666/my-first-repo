"""
小鹅通视频转逐字稿 - 转录引擎

功能：
1. 用 ffmpeg 从视频提取音频
2. 用 faster-whisper (GPU 加速) 转文字
3. 输出 SRT 字幕 + 纯文本 + JSON 完整结果
"""

import os
import sys
import json
import time
import argparse
import subprocess
from pathlib import Path

# ============================================================
# 配置
# ============================================================
CUBA_LIB = r"C:\Users\William\AppData\Local\Programs\Python\Python311\Lib\site-packages\nvidia\cublas\bin"
CUDNN_LIB = r"C:\Users\William\AppData\Local\Programs\Python\Python311\Lib\site-packages\nvidia\cudnn\bin"
FFMPEG_PATH = r"C:\Users\William\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffmpeg.exe"

# 确保 CUDA DLLs 可被加载
os.environ.setdefault('PATH', '')
os.environ['PATH'] += f";{CUBA_LIB};{CUDNN_LIB}"


class VideoTranscriber:
    """视频转文字引擎"""

    def __init__(self, model_size="medium", device="cuda", compute_type="float16"):
        """
        初始化转录引擎

        Args:
            model_size: whisper 模型大小 (tiny/base/small/medium/large)
            device: 运行设备 (cuda/cpu)
            compute_type: 精度类型 (float16/int8_float16/float32等)
                - GPU推荐: float16 (最快), int8_float16 (更省显存)
                - CPU推荐: int8 (最快), int8_float32
        """
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.model = None

    def load_model(self):
        """加载 faster-whisper 模型"""
        print(f"🔧 加载模型: {self.model_size} (设备: {self.device}, 精度: {self.compute_type})")
        print(f"📊 显存信息: 请稍候...")

        from faster_whisper import WhisperModel
        start = time.time()
        self.model = WhisperModel(
            self.model_size,
            device=self.device,
            compute_type=self.compute_type,
            # 对中文优化
            local_files_only=False,
        )
        elapsed = time.time() - start
        print(f"✅ 模型加载完成 (耗时: {elapsed:.1f}秒)")

        # 显示 GPU 信息
        try:
            import ctranslate2
            cuda_count = ctranslate2.get_cuda_device_count()
            compute_types = ctranslate2.get_supported_compute_types("cuda")
            print(f"   GPU 设备数: {cuda_count}")
            print(f"   支持的精度: {compute_types}")
        except:
            pass

    def extract_audio(self, video_path, audio_path=None, sample_rate=16000):
        """
        用 ffmpeg 从视频提取音频

        Args:
            video_path: 视频文件路径
            audio_path: 输出音频路径 (默认: 视频名.wav)
            sample_rate: 采样率 (whisper 需要 16kHz)

        Returns:
            音频文件路径
        """
        video_path = Path(video_path)
        if not video_path.exists():
            raise FileNotFoundError(f"视频文件不存在: {video_path}")

        if audio_path is None:
            audio_path = video_path.with_suffix('.wav')

        audio_path = Path(audio_path)

        print(f"🎵 提取音频: {video_path.name}")
        print(f"   → 输出: {audio_path.name}")

        start = time.time()
        cmd = [
            str(FFMPEG_PATH),
            "-y",  # 覆盖已存在文件
            "-i", str(video_path),
            "-vn",  # 不要视频流
            "-acodec", "pcm_s16le",  # 16-bit PCM
            "-ar", str(sample_rate),  # 16kHz
            "-ac", "1",  # 单声道
            str(audio_path),
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg 错误: {result.stderr}")

        elapsed = time.time() - start
        file_size_mb = audio_path.stat().st_size / (1024 * 1024)
        print(f"✅ 音频提取完成 (耗时: {elapsed:.1f}秒, 大小: {file_size_mb:.1f}MB)")

        return str(audio_path)

    def transcribe(self, audio_path, language="zh", beam_size=5):
        """
        转写音频为文字

        Args:
            audio_path: 音频文件路径
            language: 语言代码 (zh/en/ja 等, 或 None 自动检测)
            beam_size: 束搜索大小 (越大越准但越慢, 默认5)

        Returns:
            转录结果 (包含 segments 和 info)
        """
        if self.model is None:
            self.load_model()

        print(f"🎤 开始转写: {Path(audio_path).name}")
        print(f"   🌐 语言: {language or '自动检测'}")
        print(f"   ⏳ 这可能需要一些时间...")

        start = time.time()

        segments, info = self.model.transcribe(
            audio_path,
            language=language,
            beam_size=beam_size,
            vad_filter=True,  # 过滤静音部分
            vad_parameters=dict(
                min_silence_duration_ms=500,
            ),
            word_timestamps=True,  # 获取每个词的时间戳
        )

        # 收集结果
        result_segments = []
        total_duration = 0

        print(f"\n📝 转写进度:")
        for i, segment in enumerate(segments):
            seg_dict = {
                "id": segment.id,
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
                "words": [],
            }

            if hasattr(segment, 'words') and segment.words:
                for word in segment.words:
                    seg_dict["words"].append({
                        "word": word.word,
                        "start": word.start,
                        "end": word.end,
                        "probability": word.probability,
                    })

            result_segments.append(seg_dict)
            total_duration = segment.end

            # 显示进度
            if (i + 1) % 10 == 0 or i == 0:
                progress = f"[{i+1}段] {time.strftime('%H:%M:%S', time.gmtime(segment.start))} → {segment.text[:60]}..."
                print(f"   {progress}")

        elapsed = time.time() - start
        audio_duration = info.duration if hasattr(info, 'duration') else total_duration

        print(f"\n✅ 转写完成!")
        print(f"   📊 音频时长: {audio_duration:.1f}秒 ({audio_duration/60:.1f}分钟)")
        print(f"   ⏱  处理耗时: {elapsed:.1f}秒 ({elapsed/60:.1f}分钟)")
        print(f"   🚀 加速比: {audio_duration/elapsed:.1f}x")
        print(f"   📝 总段落: {len(result_segments)}")

        return {
            "language": info.language if hasattr(info, 'language') else language,
            "duration": audio_duration,
            "processing_time": elapsed,
            "speedup": audio_duration / elapsed if elapsed > 0 else 0,
            "segments": result_segments,
        }

    def format_srt(self, result):
        """格式化为 SRT 字幕"""
        lines = []
        for i, seg in enumerate(result["segments"]):
            start_ts = self._seconds_to_srt(seg["start"])
            end_ts = self._seconds_to_srt(seg["end"])
            lines.append(str(i + 1))
            lines.append(f"{start_ts} --> {end_ts}")
            lines.append(seg["text"])
            lines.append("")
        return "\n".join(lines)

    def format_text(self, result):
        """格式化为纯文本"""
        paragraphs = []
        for seg in result["segments"]:
            paragraphs.append(seg["text"])
        return "\n\n".join(paragraphs)

    def format_markdown(self, result, title="逐字稿"):
        """格式化为 Markdown 逐字稿"""
        lines = [
            f"# {title}",
            "",
            f"> 🎤 语言: {result['language']}  |  "
            f"⏱ 时长: {result['duration']/60:.1f}分钟  |  "
            f"⚡ 处理耗时: {result['processing_time']/60:.1f}分钟  |  "
            f"🚀 加速比: {result['speedup']:.1f}x",
            "",
            "---",
            "",
        ]

        for seg in result["segments"]:
            start_ts = self._seconds_to_timestamp(seg["start"])
            end_ts = self._seconds_to_timestamp(seg["end"])
            lines.append(f"#### {start_ts} - {end_ts}")
            lines.append("")
            lines.append(seg["text"])
            lines.append("")

        return "\n".join(lines)

    def save_all_formats(self, result, base_path, title="逐字稿"):
        """保存所有格式的输出文件"""
        base_path = Path(base_path)
        ext = base_path.suffix
        stem = base_path.stem if base_path.suffix else base_path.name

        output_dir = base_path.parent
        output_dir.mkdir(parents=True, exist_ok=True)

        # 1. SRT 字幕
        srt_path = output_dir / f"{stem}.srt"
        srt_path.write_text(self.format_srt(result), encoding="utf-8")
        print(f"   📄 SRT 字幕: {srt_path}")

        # 2. 纯文本
        txt_path = output_dir / f"{stem}.txt"
        txt_path.write_text(self.format_text(result), encoding="utf-8")
        print(f"   📄 纯文本: {txt_path}")

        # 3. Markdown 逐字稿
        md_path = output_dir / f"{stem}-逐字稿.md"
        md_path.write_text(self.format_markdown(result, title), encoding="utf-8")
        print(f"   📄 逐字稿: {md_path}")

        # 4. JSON 完整数据
        json_path = output_dir / f"{stem}.json"
        json_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   📄 完整数据: {json_path}")

    @staticmethod
    def _seconds_to_srt(seconds):
        """秒 → SRT 时间格式 (HH:MM:SS,mmm)"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        ms = int((seconds - int(seconds)) * 1000)
        return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

    @staticmethod
    def _seconds_to_timestamp(seconds):
        """秒 → 可读时间戳 (HH:MM:SS)"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = int(seconds % 60)
        return f"{h:02d}:{m:02d}:{s:02d}"


def main():
    parser = argparse.ArgumentParser(description="小鹅通视频转逐字稿")
    parser.add_argument("input", help="视频文件路径 或 包含视频路径的 JSON 文件")
    parser.add_argument("--model", default="medium",
                        choices=["tiny", "base", "small", "medium", "large"],
                        help="Whisper 模型大小 (默认: medium)")
    parser.add_argument("--device", default="cuda",
                        choices=["cuda", "cpu"],
                        help="运行设备 (默认: cuda)")
    parser.add_argument("--compute", default="int8_float16",
                        help="精度类型 (默认: int8_float16)")
    parser.add_argument("--language", default="zh",
                        help="语言代码 (默认: zh)")
    parser.add_argument("--output", "-o", default=None,
                        help="输出文件路径 (默认: 与输入同名)")
    parser.add_argument("--beam", type=int, default=5,
                        help="束搜索大小 (默认: 5)")
    parser.add_argument("--list-models", action="store_true",
                        help="列出可用的模型")

    args = parser.parse_args()

    if args.list_models:
        from faster_whisper import available_models
        print("可用的 faster-whisper 模型:")
        for m in available_models():
            print(f"  - {m}")
        return

    # 创建转录器
    transcriber = VideoTranscriber(
        model_size=args.model,
        device=args.device,
        compute_type=args.compute,
    )

    # 加载模型
    transcriber.load_model()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"❌ 文件不存在: {args.input}")
        sys.exit(1)

    # 判断是否需要提取音频
    audio_ext = Path(args.input).suffix.lower()
    if audio_ext in ('.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac'):
        print(f"🎵 输入已是音频文件，跳过提取: {Path(args.input).name}")
        audio_path = args.input
    else:
        audio_path = transcriber.extract_audio(args.input)

    # 转写
    result = transcriber.transcribe(audio_path, language=args.language, beam_size=args.beam)

    # 保存结果
    output_base = args.output or str(input_path.with_suffix(''))
    title = f"逐字稿 - {input_path.stem}"
    transcriber.save_all_formats(result, output_base, title)

    # 清理临时音频
    # os.remove(audio_path)


if __name__ == "__main__":
    main()
