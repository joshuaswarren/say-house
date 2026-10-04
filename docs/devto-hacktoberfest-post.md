# Say House: plain English for the lights, on the LAN

Tags: `#devchallenge` `#weekendchallenge` `#hf26challenge`

## The friend

A friend should not have to open the Hue app, or Home Assistant, to dim a room or turn a bedroom light off. They already know the words. “Kitchen bright.” “Movie lights.” “All lights off.”

Say House is one page for that. Tap Talk and say the sentence. The words show up as you speak, Send confirms them, and the house does the one thing on the list. Typing uses the same path.

The repo is generic. The demo allowlist is a fictional home with sample entity ids. A real house stays in a gitignored `config.local.yaml`. Mock mode runs the story with no bridge and no token.

## Why the model stays local

The sentence is about the house. Which room, what “bright” means, whether everything should go dark. That is not something to ship to a cloud API just to pick an alias.

Say House talks to an OpenAI-compatible local server. The one this house already runs is a LiteLLM proxy in front of an open-weight model:

- Base URL: `http://LITELLM_HOST:4000/v1` (set `LLM_BASE_URL` in gitignored `.env`; a LAN or Tailscale host stays there)
- Preferred alias: `qwen3.8-27b-64k-nothink`
- Fallback alias: `qwen3.8-27b-64k-fast`
- Bearer key from `LLM_API_KEY` (or `LITELLM_API_KEY` / `OPENAI_API_KEY`), never committed

The model returns one JSON alias. It never sees entity ids, the Home Assistant token, or the Hue application key. If the proxy is unset or returns an error, a keyword backup maps the phrases in the allowlist. The backup cannot skip the same checks. A cloud VM that cannot reach the proxy still passes `npm run smoke` against a fake model server.

Gemma works too, if that is the model behind the same `/v1/chat/completions` endpoint. It is optional. This project does not depend on it.

## What it will and will not do

Allowlist only. The server calls Home Assistant with `scene.turn_on`, `light.turn_on`, or `light.turn_off`, and only for ids in the file. Hue uses room `grouped_light` for on/off and scene recall for scenes.

“All lights off” turns off the downstairs and upstairs room lights after a yes. It does not flip a Hue schedule switch.

Locks, the garage, alarms, cameras, climate setpoints, water, vacuums, vents, and scripts are refused even if they are pasted into the config.

## Demo script

1. `npm install && SAYHOUSE_CONFIG=config.example.demo-home.yaml npm run dev`
2. Open http://127.0.0.1:47231
3. “kitchen bright” → the kitchen bright scene, in mock mode
4. “movie night” → refused, with a hint to say “movie lights”
5. “movie lights” → media room dim
6. “goodnight” → downstairs nightlight, and a note that there is no bedtime scene
7. “all lights off” → confirm, then yes → downstairs and upstairs off
8. “open the garage” → refused
9. Tick Dry run, then “bedroom off” → the sentence, and nothing sent
10. Point `LLM_BASE_URL` at the proxy and try “make it cozy where we cook” → `kitchen relax`, if the model is up

MIT license. Mock mode needs no keys.
