Measurement only (#978, step 1). Not meant to merge.

Standalone routes for the channel offset at a 1203 x 677 preview:
  plain, svg (the app's url() filter), copies (three channel-isolated
  <video> copies screened together), webgl (one shader pass).
Each with and without blur(1.805px), VHS's Amount 100 blur at that width.

  cd e2e/measure-978-routes
  ffmpeg -f lavfi -i testsrc2=size=1920x1080:rate=30 -t 8 -c:v libvpx-vp9 \
    -b:v 2M -deadline realtime -cpu-used 8 src.webm
  python3 -m http.server 8765 --bind 127.0.0.1 &
  node run.mjs <chromium executable> .

The in-app variants are e2e/measure-978.spec.ts, driven by MEASURE_978_*.
