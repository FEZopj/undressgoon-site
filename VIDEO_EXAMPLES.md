# Video examples

Place the curated public assets in `video-examples/`, then add one manifest
entry per video in `video-examples/manifest.json`:

```json
{
  "ok": true,
  "examples": [
    {
      "id": "example-a",
      "source": "example-a-source.webp",
      "video": "example-a.mp4",
      "poster": "example-a-poster.webp",
      "title": "Undress video"
    }
  ]
}
```

`source` is the original image shown as the labeled before-reference. Several
videos can point to the same source image.

Recommended delivery format: portrait 480p H.264 MP4, eight seconds, muted,
with fast-start enabled. Posters should use the same aspect ratio as the video.
The homepage randomizes the manifest entries and avoids repeats within the
current browser session.
