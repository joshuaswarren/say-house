# Say House

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink)](https://github.com/sponsors/joshuaswarren)

Say House is a small web page for someone who lives in a house and does not want another dashboard. They say “kitchen bright”, “bedroom off”, or “movie lights”. A local open-weight model turns that into one allowlisted action. Home Assistant or a Philips Hue bridge does the work. The Hue app can stay closed.

The app is generic. `config.example.yaml` is a short fictional allowlist. `config.example.demo-home.yaml` is a longer fictional demo (see [docs/demo-home.md](docs/demo-home.md)). A real house belongs in `config.local.yaml` or `config.yaml`, both gitignored, with tokens in `.env` or `.env.local`. Nothing about a specific household is hardcoded.

## Talk

Talk is the main control. Tap it, say what you want, and the interim transcript shows up as you speak. Send puts those words through the same allowlist as typing. Edit the line first if the browser misheard.

The browser asks for the microphone the first time. Say House does not upload that audio and does not need a speech-vendor account. Chrome and Edge may still use the browser's own speech service to write the transcript. What this app receives is the text you send.

Talk needs a secure page: `https`, or `http://127.0.0.1` / `http://localhost`. If the browser has no Web Speech API, the page says so and typing still works. That is common on Firefox, and on Safari versions without speech recognition.

## Why a local model

The sentence is about the house: which room, what “bright” means, whether the lights should go off. That does not need to leave the LAN to be parsed.

Say House calls an OpenAI-compatible endpoint (`/v1/chat/completions`). The preferred setup is an existing LiteLLM proxy in front of an open-weight model:

- Base URL: `http://LITELLM_HOST:4000/v1` (`LLM_BASE_URL`)
- Model alias: `qwen3.8-27b-64k-nothink` (no think trace). Fallback alias: `qwen3.8-27b-64k-fast`
- Key: `LLM_API_KEY`, or `LITELLM_API_KEY`, or `OPENAI_API_KEY`

A cloud machine often cannot reach a LAN or Tailscale address. Put that real URL in gitignored `.env` or `.env.local` only. Mock mode and `npm run smoke` do not need it. Without `LLM_BASE_URL`, or when the proxy returns an error, a keyword backup maps the phrases already in the allowlist. That backup cannot skip the allowlist.

Gemma is optional. Ollama, LM Studio, or any other server that speaks the same API works if you change `LLM_BASE_URL` and `LLM_MODEL`.

The model may only name an alias from the allowlist. It never receives entity ids, the Home Assistant token, or the Hue application key. The server drops anything that is not on the list. A second hard deny blocks locks, garage doors, alarms, cameras, climate setpoints, water, vacuums, vents, scripts, and Hue schedule switches even if they were pasted into the file.

## Privacy

Household names, real entity lists, and secrets stay on the machine that runs the app.

- Copy an example to `config.local.yaml` and edit it there.
- Put `HA_TOKEN`, `HUE_APP_KEY`, and `LLM_API_KEY` in `.env` or `.env.local`.
- Put Tailscale and LAN URLs in those same gitignored files: `LLM_BASE_URL`, `HA_URL`, and the Hue bridge host. `config.local.yaml` is the other gitignored place for house-specific config.
- Microphone audio stays in the browser. This app only receives the text you send.
- Those files are gitignored. Do not commit them.

## Run the mock in five minutes

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:47231](http://127.0.0.1:47231). The short sample is loaded. Tap Talk and say “kitchen bright”, or type it. Nothing is sent to a bridge.

Check it:

```bash
npm run smoke
```

### Fictional demo home, still with no hardware

```bash
SAYHOUSE_CONFIG=config.example.demo-home.yaml npm run dev
```

That file defaults to `backend: mock`. The cheat sheet is [docs/demo-home.md](docs/demo-home.md).

## LiteLLM in five minutes

On a machine that can reach the proxy:

```bash
LLM_BASE_URL=http://LITELLM_HOST:4000/v1
LLM_MODEL=qwen3.8-27b-64k-nothink
LLM_API_KEY=your-local-key
```

Use your LAN or Tailscale address for `LITELLM_HOST`, and keep that URL in gitignored `.env`. A request with no key gets `401`, which is expected. Restart `npm run dev`. The header shows the model name. A phrase that is not in the keyword list, such as “make it cozy where we cook” on the demo allowlist, only resolves if the model maps it to an alias like `kitchen relax`.

The model is asked for JSON only:

```json
{"action":"activate_scene","target_alias":"kitchen relax","brightness_pct":null,"reason":"cozy kitchen"}
```

## Home Assistant in five minutes

1. In Home Assistant: your profile → Security → Long-lived access tokens. Create one. It stays in `.env` only.
2. Copy the allowlist:

   ```bash
   cp config.example.demo-home.yaml config.local.yaml
   cp .env.example .env
   ```

3. Replace the sample `entity_id` values. Scenes are `scene.*`. Room on/off is the Hue **room or zone** `light.*` entity, not each bulb.
4. In `.env`:

   ```bash
   BACKEND=homeassistant
   HA_URL=http://homeassistant.local:8123
   HA_TOKEN=your-long-lived-token
   ```

   `HASS_TOKEN` is accepted as another name for the same token. `HA_URL` is the origin only, with no path and no token in the URL. A Tailscale MagicDNS name or other private URL belongs in gitignored `.env` only.

5. `npm run dev`, then say something on the allowlist.

`npm run discover` with those variables set prints `light` and `scene` entities that pass the deny list, and skips the rest.

Service calls:

- scene: `POST /api/services/scene/turn_on` with `entity_id`
- room or light on: `POST /api/services/light/turn_on`
- room or light off: `POST /api/services/light/turn_off`

A broad target such as all lights off asks for yes first. In the demo that call is `light.turn_off` on the downstairs and upstairs room lights. It never calls `switch.automation_all_lights_off`.

## Hue bridge in five minutes

This is the local CLIP API v2. Entertainment areas are not required.

1. On the bridge, press the link button.
2. Create an application key (the same username the v1 API returns):

   ```bash
   curl -k -X POST "https://BRIDGE_IP/api" \
     -H "content-type: application/json" \
     -d '{"devicetype":"sayhouse#cli","generateclientkey":true}'
   ```

   If it says the link button was not pressed, press it and run the command again within about 30 seconds. The `username` in the response is `HUE_APP_KEY`.

3. In `.env`:

   ```bash
   BACKEND=hue
   HUE_BRIDGE_IP=<bridge-ip>
   HUE_APP_KEY=the-username
   ```

4. `npm run discover` lists rooms and scenes. For room on/off, copy the room’s `grouped_light` id, not every bulb. For a scene, copy the scene id.
5. Put those ids on the allowlist:

   ```yaml
   hue:
     id: YOUR_GROUPED_LIGHT_ID
     rtype: grouped_light
   ```

   Scenes use `rtype: scene`. Say House recalls them with `{"recall":{"action":"active"}}`.

The bridge uses a certificate your laptop will not trust. Say House turns certificate checks off only for the host in `HUE_BRIDGE_IP`, not for Home Assistant or the model.

`REPLACE_WITH_...` ids in the short example are placeholders. Mock mode ignores them. The Hue backend refuses to call them until you replace them.

## Allowlist

Edit `config.local.yaml`. Each target has an alias, the words people say, a kind (`light` or `scene`), and either Home Assistant entity ids, Hue resources, or both.

- `brightness: true` lets a light take “bright”, “dim”, or a percent. Leave it off when bright and dim are separate scenes, which is how the demo file works.
- `actions: [turn_off]` limits a target. All-lights-off is turn-off only.
- `broad: true` asks for yes before it runs.
- `gaps` are phrases that should be refused in plain English instead of guessed. The demo file uses these for movie night, bedtime, dinner, porch, away, and stock Hue formulas.
- `on_said` is the sentence the page shows after a scene starts.

`DRY_RUN=true` in `.env` forces every command to describe itself and send nothing. The page also has a Dry run checkbox.

## Demo aliases

Full table: [docs/demo-home.md](docs/demo-home.md). The ids there are samples. Replace them locally.

| Say | Action |
| --- | --- |
| kitchen bright / relax / dim | `scene.kitchen_bright`, `scene.kitchen_relax`, `scene.kitchen_dimmed` |
| kitchen on / off | `light.kitchen` |
| living room bright / relax | `scene.living_room_bright`, `scene.living_room_relax` |
| living room on / off | `light.living_room` |
| downstairs bright / dim / nightlight | `scene.downstairs_bright`, `scene.downstairs_dimmed`, `scene.downstairs_nightlight` |
| movie lights | `scene.media_room_dimmed` only |
| media room on / off | `light.media_room` |
| hallway sleep | `scene.hallway_sleep` |
| bedroom on / off | `light.master_bedroom` |
| all lights off | `light.downstairs` and `light.upstairs`, after yes |
| outdoor on / off | six outdoor lights together, never a camera light |
| dining room bright, dining room on/off | `scene.dining_room_bright`, `light.dining_room` |
| entryway on/off | `light.entryway` |
| game room relax, game room on/off | `scene.game_room_relax`, `light.game_room` |

## Safety

- The model proposes a structured alias. The server executes only allowlisted targets.
- Home Assistant calls are only `light.turn_on`, `light.turn_off`, and `scene.turn_on`.
- Name tokens such as garage, camera, lock, alarm, tesla, vacuum, and schedule are rejected at load time.
- “All lights off” never touches `switch.automation_all_lights_off`.
- There is no account system. Run it on the LAN. Do not put it on the public internet with a token in the environment.

## Project layout

- `src/app` — the page and `/api/chat`, `/api/health`
- `src/lib` — config, model client, allowlist, Home Assistant, Hue, mock
- `scripts/smoke.ts` — mock phrases, a fake model HTTP server, and both adapters against local fake servers
- `scripts/discover.ts` — list HA entities or Hue rooms and scenes

```bash
npm run dev      # http://127.0.0.1:47231
npm run smoke
npm run lint
npm run discover
```

## Hacktoberfest

Built for [DEV Hacktoberfest 2026, Weekend Challenge #1: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01). The draft post is [docs/devto-hacktoberfest-post.md](docs/devto-hacktoberfest-post.md).

## Support

Every bit of support helps keep say-house alive and free. If you are able, [sponsor on GitHub](https://github.com/sponsors/joshuaswarren) or send a Lightning donation to `joshuaswarren@strike.me` to directly fund continued development and new integrations.

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?style=for-the-badge)](https://github.com/sponsors/joshuaswarren)

If financial support is not an option, you can still make a big difference: [star the repo](https://github.com/joshuaswarren/say-house), share it, or recommend it to a colleague. Word of mouth is how most people find say-house.

## License

MIT. See [LICENSE](LICENSE).