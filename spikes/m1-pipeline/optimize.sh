#!/bin/sh
# THROWAWAY SPIKE SCRIPT (M1 pipeline spike, 2026-10-12). Stage 4: gltf-transform 4.5.1 + KTX-Software 4.4.2.
# Run from the repo root after the two Blender stages. Prints wall-clock per variant.
set -e
O=spikes/m1-pipeline/out
GT=node_modules/.bin/gltf-transform
RAW=$O/raw/corner.raw.glb
# --simplify false: optimize simplifies by default, which would rewrite the lightmap UVs.
# --prune-attributes false: TEXCOORD_1 is referenced by no glTF material (the lightmap ships
#   outside the GLB), so the default prune deletes the lightmap UV set.
KEEP="--simplify false --prune-attributes false"

t() { s=$(date +%s); "$@"; echo "[time] $(($(date +%s) - s)) s: $*" | cut -c1-140; }

case "${1:-all}" in
default|all)
  # A: one-liner defaults (UASTC for normal + occlusion, ETC1S for colour)
  t $GT optimize $RAW $O/raw/corner.ktx2-default.glb --compress meshopt --texture-compress ktx2 $KEEP
  ;;
esac
case "${1:-all}" in
tuned|all)
  # B: tuned. Geometry passes first, then UASTC+RDO+zstd for normals only, ETC1S for colour and AO.
  t $GT optimize $RAW $O/raw/_geo.glb --compress false --texture-compress false $KEEP
  t $GT uastc $O/raw/_geo.glb $O/raw/_n.glb --slots "normalTexture" --level 2 --rdo --rdo-lambda 4 --zstd 18
  t $GT etc1s $O/raw/_n.glb $O/raw/_e.glb --slots "{baseColorTexture,occlusionTexture}"
  t $GT meshopt $O/raw/_e.glb $O/corner.ktx2.glb
  ;;
esac
case "${1:-all}" in
webp|all)
  # C: WebP for comparison (smallest download, uncompressed in VRAM)
  t $GT optimize $RAW $O/corner.webp.glb --compress meshopt --texture-compress webp $KEEP
  ;;
esac
case "${1:-all}" in
lightmap|all)
  # Lightmap lives outside the GLB (one file per mood); sRGB-encoded 8-bit, decoded to linear by KTX2Loader.
  t ktx create --format R8G8B8_SRGB --encode uastc --uastc-quality 2 --zstd 18 --generate-mipmap \
    $O/lightmap_golden.png $O/lightmap_golden.uastc.ktx2
  t ktx create --format R8G8B8_SRGB --encode basis-lz --qlevel 192 --generate-mipmap \
    $O/lightmap_golden.png $O/lightmap_golden.etc1s.ktx2
  ;;
esac
ls -l $O/*.glb $O/*.ktx2 $O/raw/*.glb
