#!/usr/bin/env python3
"""Render the supplied QP PDFs as original-wording assets; never read mark schemes.

This offline authoring tool does not connect to an application or database and does
not execute any candidate or reference program. Run with pdfplumber and Pillow.
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PAPER_KEY = re.compile(r"9618_[sw]\d{2}_4[123]\Z")
QUESTION = re.compile(r"^([123])\s+[A-Z]")
PART = re.compile(r"^\(([a-z])\)\s+")
SCALE = 2
DPI = 72 * SCALE
# ECMAScript WhiteSpace + LineTerminator, matching String.prototype.trim().
# Python's default strip() differs for FEFF and several control characters.
STATEMENT_TRIM_CHARS = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def statement_sha256(statement: str) -> str:
    """Match the domain's field() import normalization; keep inner text exact."""
    return sha256(statement.strip(STATEMENT_TRIM_CHARS).encode("utf-8"))


@dataclass(frozen=True, order=True)
class Position:
    page: int  # Zero based internally; public manifests use one based pages.
    y: float


def body_bounds(page) -> tuple[float, float, float, float]:
    """Exclude page numbers and publisher footers, never infer a text-only bbox."""
    lines = page.extract_text_lines()
    footer_tops = [line["top"] for line in lines
                   if line["top"] > page.height * .9
                   and ("©" in line["text"] or "[Turn over" in line["text"])]
    bottom = min(footer_tops) - 1 if footer_tops else page.height - 43
    top = 57.0
    # Standard papers use 49.6–545.7 pt. Preserve extra whitespace on both sides.
    left, right = 41.0, page.width - 41.0
    return left, top, right, bottom


def marker_position(page_index: int, marker: dict, lines: list, top: float) -> Position:
    """Use a whitespace cut even when the previous line is unusually close."""
    marker_top = marker["top"]
    boundary = max(top, marker_top - 8)
    earlier_bottoms = [line["bottom"] for line in lines
                       if top <= line["top"] < marker_top and line["bottom"] <= marker_top]
    previous_bottom = max(earlier_bottoms, default=top)
    if previous_bottom > boundary:
        boundary = (previous_bottom + marker_top) / 2
    if any(line["top"] < boundary < line["bottom"] for line in lines):
        raise ValueError(f"No safe text boundary on original page {page_index + 1}")
    return Position(page_index, boundary)


def inspect_pdf(pdf_bytes: bytes) -> tuple[list, list, dict, int]:
    import pdfplumber

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        pages = []
        questions: list[tuple[str, Position]] = []
        parts: dict[str, list[tuple[str, Position]]] = {}
        current = None
        for page_index, page in enumerate(pdf.pages):
            bounds = body_bounds(page)
            lines = page.extract_text_lines()
            blank = any("BLANK PAGE" in line["text"] for line in lines)
            pages.append({"width": page.width, "height": page.height,
                          "bounds": bounds, "blank": blank})
            if page_index == 0 or blank:
                continue
            for line in lines:
                if bounds[1] < line["top"] < bounds[3] and line["bottom"] > bounds[3]:
                    raise ValueError(f"Body text crosses footer boundary on page {page.page_number}")
                if not bounds[1] <= line["top"] < bounds[3]:
                    continue
                text = line["text"].strip()
                x = line["x0"]
                marker = QUESTION.match(text)
                if marker and 40 <= x <= 60:
                    current = "Q" + marker[1]
                    position = marker_position(page_index, line, lines, bounds[1])
                    questions.append((current, position))
                    parts[current] = []
                marker = PART.match(text)
                if marker and 60 <= x <= 80:
                    if current is None:
                        raise ValueError("Subpart found before a question marker")
                    position = marker_position(page_index, line, lines, bounds[1])
                    parts[current].append((marker[1], position))
        if [key for key, _ in questions] != ["Q1", "Q2", "Q3"]:
            raise ValueError(f"Expected exactly Q1/Q2/Q3, found {questions!r}")
        for key, markers in parts.items():
            actual = [part for part, _ in markers]
            expected = [chr(ord("a") + index) for index in range(len(markers))]
            if not markers or actual != expected:
                raise ValueError(f"Unordered or missing primary subparts in {key}: {actual!r}")
        final_page = max(index for index, page in enumerate(pages)
                         if index and not page["blank"])
        return pages, questions, parts, final_page


def render_paper(entry: dict, archive: zipfile.ZipFile, output: Path,
                 pdftoppm: str, temporary: Path) -> dict:
    from PIL import Image, ImageChops

    key = entry["key"]
    if not PAPER_KEY.fullmatch(key):
        raise ValueError(f"Unsafe paper key: {key}")
    qp_name = re.sub(r"_(4[123])$", r"_qp_\1.pdf", key)
    matches = [name for name in archive.namelist()
               if PurePosixPath(name).name == qp_name and "__MACOSX" not in PurePosixPath(name).parts]
    if len(matches) != 1:
        raise ValueError(f"Expected one original question PDF for {key}, found {len(matches)}")
    source_entry = archive.getinfo(matches[0])
    if source_entry.file_size > 8 * 1024 * 1024:
        raise ValueError(f"Original question PDF too large: {key}")
    source = archive.read(source_entry)
    source_hash = sha256(source)
    expected_hash = entry["sourceChecksums"]["qp"]
    if source_hash != expected_hash:
        raise ValueError(f"Original question PDF hash mismatch for {key}")
    package_path = ROOT / "content/paper4-pastpapers" / entry["path"]
    package = json.loads(package_path.read_text(encoding="utf-8"))
    authored_questions = {question["key"]: question for question in package["questions"]}
    pages, question_markers, part_markers, final_page = inspect_pdf(source)
    if set(authored_questions) != {"Q1", "Q2", "Q3"}:
        raise ValueError(f"Expected three authored questions for {key}")
    work = temporary / key
    work.mkdir()
    pdf_path = work / "question-paper.pdf"
    pdf_path.write_bytes(source)
    subprocess.run([pdftoppm, "-f", "2", "-l", str(final_page + 1),
                    "-r", str(DPI), "-png", str(pdf_path), str(work / "page")],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    rendered = {int(path.stem.rsplit("-", 1)[1]) - 1: path
                for path in work.glob("page-*.png")}
    generated = work / "assets"
    generated.mkdir()
    shutil.copy2(pdf_path, generated / "question-paper.pdf")
    images = {}
    for index, path in rendered.items():
        with Image.open(path) as image:
            images[index] = image.convert("RGB")
    segments_count = 0
    cropped_pages = set()

    def segments(start: Position, end: Position, prefix: str) -> list[dict]:
        nonlocal segments_count
        result = []
        if not start < end:
            raise ValueError(f"Non-positive segment range in {key}/{prefix}")
        for page_index in range(start.page, end.page + 1):
            if page_index > final_page or pages[page_index]["blank"]:
                continue
            page = pages[page_index]
            left, top, right, bottom = page["bounds"]
            if page_index == start.page:
                top = max(top, start.y)
            if page_index == end.page:
                bottom = min(bottom, end.y)
            if bottom <= top:
                continue
            image = images[page_index]
            scale_x = image.width / page["width"]
            scale_y = image.height / page["height"]
            pixel_rect = (math.floor(left * scale_x), math.floor(top * scale_y),
                          math.ceil(right * scale_x), math.ceil(bottom * scale_y))
            if not (0 <= pixel_rect[0] < pixel_rect[2] <= image.width and
                    0 <= pixel_rect[1] < pixel_rect[3] <= image.height):
                raise ValueError(f"Crop outside the original page: {key}/{prefix}/{page_index + 1}")
            crop = image.crop(pixel_rect)
            # Trim only vertical blank margins. Full horizontal geometry remains
            # unchanged, including diagram edges and right-aligned mark boxes.
            ink = ImageChops.difference(crop, Image.new("RGB", crop.size, "white")).convert("L")
            ink = ink.point(lambda value: 255 if value > 8 else 0)
            bbox = ink.getbbox()
            if bbox is None:
                continue
            padding = round(8 * scale_y)
            crop = crop.crop((0, max(0, bbox[1] - padding), crop.width,
                              min(crop.height, bbox[3] + padding)))
            name = f"{prefix}-p{page_index + 1:02d}.webp"
            crop.save(generated / name, "WEBP", quality=96, method=6)
            result.append({"src": name, "width": crop.width, "height": crop.height,
                           "page": page_index + 1})
            segments_count += 1
            cropped_pages.add(page_index + 1)
        if not result:
            raise ValueError(f"Empty original-wording section: {key}/{prefix}")
        return result

    questions = {}
    for index, (question_key, question_start) in enumerate(question_markers):
        question_end = (question_markers[index + 1][1]
                        if index + 1 < len(question_markers)
                        else Position(final_page, pages[final_page]["bounds"][3]))
        markers = part_markers[question_key]
        # The first question retains the supplied-file/evidence instructions.
        stem_start = Position(1, pages[1]["bounds"][1]) if index == 0 else question_start
        stem = segments(stem_start, markers[0][1], question_key + "-stem")
        parts = []
        for part_index, (part_key, part_start) in enumerate(markers):
            part_end = (markers[part_index + 1][1]
                        if part_index + 1 < len(markers) else question_end)
            parts.append({"key": part_key, "label": f"({part_key})",
                          "segments": segments(part_start, part_end, f"{question_key}-{part_key}")})
        questions[question_key] = {
            "statementSha256": statement_sha256(authored_questions[question_key]["statement"]),
            "stem": stem, "parts": parts}
    manifest = {"version": 1, "paperKey": key, "sourceSha256": source_hash,
                "pdf": "question-paper.pdf", "questions": questions}
    (generated / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    destination = output / key
    destination.mkdir(parents=True, exist_ok=True)
    # Only this tool's generated files are replaced. Never remove an output tree.
    for path in generated.iterdir():
        shutil.copy2(path, destination / path.name)
    total_bytes = sum(path.stat().st_size for path in generated.iterdir())
    return {"paperKey": key, "sourceSha256": source_hash, "sourceHashVerified": True,
            "sourcePdfPages": len(pages), "renderedPages": sorted(cropped_pages),
            "internalTextBoundariesVerified": True,
            "questions": len(questions), "primaryParts": sum(len(value["parts"]) for value in questions.values()),
            "segments": segments_count, "files": len(list(generated.iterdir())), "bytes": total_bytes,
            "statementHashes": {q: value["statementSha256"] for q, value in questions.items()}}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path, help="User-supplied paper4.zip")
    parser.add_argument("--output", type=Path, default=ROOT / "apps/web/public/paper4-originals")
    parser.add_argument("--paper", action="append", default=[], help="Optional catalog paper key; repeatable")
    parser.add_argument("--pdftoppm", default=shutil.which("pdftoppm"), help="Poppler pdftoppm executable")
    args = parser.parse_args()
    if not args.pdftoppm:
        parser.error("pdftoppm is required")
    catalog = json.loads((ROOT / "content/paper4-pastpapers/catalog.json").read_text(encoding="utf-8"))
    entries = catalog["papers"]
    if args.paper:
        requested = set(args.paper)
        entries = [entry for entry in entries if entry["key"] in requested]
        if {entry["key"] for entry in entries} != requested:
            parser.error("--paper must match a key in the production catalog")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    reports = []
    with zipfile.ZipFile(args.archive) as archive, tempfile.TemporaryDirectory(prefix="campus-paper4-originals-") as tmp:
        for entry in entries:
            report = render_paper(entry, archive, output, args.pdftoppm, Path(tmp))
            reports.append(report)
            print(f"{report['paperKey']}: {report['questions']} questions, {report['primaryParts']} parts, "
                  f"{report['segments']} crops; source hash verified", flush=True)
    report = {"version": 1, "dpi": DPI, "pixelScale": SCALE,
              "sourceKind": "user-supplied-question-papers-only",
              "paperCount": len(reports), "questionCount": sum(p["questions"] for p in reports),
              "primaryPartCount": sum(p["primaryParts"] for p in reports),
              "segmentCount": sum(p["segments"] for p in reports),
              "fileCount": sum(p["files"] for p in reports),
              "totalBytes": sum(p["bytes"] for p in reports), "papers": reports}
    (output / "generation-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "papers"}, indent=2))


if __name__ == "__main__":
    main()
