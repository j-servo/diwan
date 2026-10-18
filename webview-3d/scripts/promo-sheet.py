"""Contact sheet for the promo (OpenCV; ffmpeg is unavailable here, see promo-encode.swift).
  promo-sheet.py out.jpg cols width video.mp4 n1,n2,...    frames n1.. of a video
  promo-sheet.py out.jpg cols width images a.jpg b.jpg ... the images as they are
"""
import sys

import cv2

out, cols, width, kind = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
imgs = []
if kind == "video":
    cap = cv2.VideoCapture(sys.argv[5])
    for n in [int(x) for x in sys.argv[6].split(",")]:
        cap.set(cv2.CAP_PROP_POS_FRAMES, n)
        ok, img = cap.read()
        if not ok:
            raise SystemExit(f"cannot read frame {n}")
        imgs.append(img)
else:
    imgs = [cv2.imread(p) for p in sys.argv[5:]]
h = int(imgs[0].shape[0] * width / imgs[0].shape[1])
tiles = [cv2.resize(i, (width, h), interpolation=cv2.INTER_AREA) for i in imgs]
rows = []
for r in range(0, len(tiles), cols):
    row = tiles[r : r + cols]
    row += [tiles[0] * 0] * (cols - len(row))
    rows.append(cv2.hconcat(row))
cv2.imwrite(out, cv2.vconcat(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
