# Hyperfocus

The launcher for IKELENE.net games and apps, with Nookara sign-in, friends, messages, voice and playtime.
Download: https://ikelene.net/launcher/

```bash
npm ci
npm start
npm run dist      # Windows installer in dist/
```

The launcher reads its catalogue from `https://ikelene.net/launcher/manifest.php`; the site and catalogue aren't part of this repository.
Games can talk to the launcher through the Hyperfocus Scratch extension on `http://127.0.0.1:47833` (this PC only, games it launched only).

## License

AGPL-3.0, see [LICENSE](LICENSE).
