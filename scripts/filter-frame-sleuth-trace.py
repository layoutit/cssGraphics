#!/usr/bin/env python3
"""Stream-filter an oversized Chrome JSON trace to FrameSleuth's evidence surface."""

import gzip
import json
import re
import sys


KEEP_NAMES = {
    "RunTask",
    "ThreadControllerImpl::RunTask",
    "FireAnimationFrame",
    "TimerFire",
    "FunctionCall",
    "RunMicrotasks",
    "UpdateLayoutTree",
    "RecalculateStyles",
    "Layout",
    "PrePaint",
    "Paint",
    "PaintImage",
    "UpdateLayer",
    "Layerize",
    "Commit",
    "RasterTask",
    "GPUTask",
    "DrawFrame",
    "BeginFrame",
    "AnimationFrame::Presentation",
    "PipelineReporter",
    "TracingStartedInBrowser",
    "FrameCommittedInBrowser",
    "CommitLoad",
    "FrameLoader:state_snapshot",
    "Profile",
    "ProfileChunk",
}
GC_NAME = re.compile(r"^(?:MinorGC|MajorGC|V8\.GC)")
STEADY_MARK = re.compile(r"steady.*(?:animation|playback)|(?:animation|playback).*steady", re.I)


def keep_event(event):
    name = event.get("name", "")
    return (
        event.get("ph") == "M"
        or name in KEEP_NAMES
        or GC_NAME.match(name)
        or STEADY_MARK.search(name)
    )


def filter_trace(source_path, output_path):
    decoder = json.JSONDecoder()
    marker = '"traceEvents":['
    buffer = ""
    kept = 0
    seen = 0
    with gzip.open(source_path, "rt", encoding="utf-8") as source:
        while marker not in buffer:
            chunk = source.read(1024 * 1024)
            if not chunk:
                raise ValueError("Chrome trace has no traceEvents array")
            buffer += chunk
            if len(buffer) > len(marker) * 2 and marker not in buffer:
                buffer = buffer[-len(marker) * 2 :]
        buffer = buffer.split(marker, 1)[1]
        position = 0
        with gzip.open(output_path, "wt", encoding="utf-8", compresslevel=6) as output:
            output.write('{"traceEvents":[')
            first = True
            while True:
                while True:
                    while position < len(buffer) and buffer[position] in " \r\n\t,":
                        position += 1
                    if position < len(buffer):
                        break
                    buffer = source.read(1024 * 1024)
                    position = 0
                    if not buffer:
                        raise ValueError("Chrome trace ended inside traceEvents")
                if buffer[position] == "]":
                    break
                try:
                    event, end = decoder.raw_decode(buffer, position)
                except json.JSONDecodeError:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        raise ValueError("Chrome trace ended inside an event")
                    buffer = buffer[position:] + chunk
                    position = 0
                    continue
                if not isinstance(event, dict):
                    raise ValueError("Chrome trace event is not an object")
                seen += 1
                if keep_event(event):
                    if not first:
                        output.write(",")
                    json.dump(event, output, separators=(",", ":"), ensure_ascii=False)
                    first = False
                    kept += 1
                position = end
                if position > 1024 * 1024:
                    buffer = buffer[position:]
                    position = 0
            output.write('],"metadata":{"filteredFor":"FrameSleuth","sourceTrace":"')
            output.write(source_path.replace("\\", "\\\\").replace('"', '\\"'))
            output.write('"}}')
    return seen, kept


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: filter-frame-sleuth-trace.py <source.json.gz> <output.json.gz>")
    seen_count, kept_count = filter_trace(sys.argv[1], sys.argv[2])
    print(json.dumps({"seen": seen_count, "kept": kept_count}))
