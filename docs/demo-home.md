# Demo home

Say House is generic. This page is a fictional speakable map you can run with no hardware. The short starter is `config.example.yaml`. This longer sample is `config.example.demo-home.yaml`.

Copy it to `config.local.yaml` (gitignored) and replace the `example_` entity ids with the rooms in your house. Do not commit that file. Do not commit tokens.

## Mock

```bash
SAYHOUSE_CONFIG=config.example.demo-home.yaml npm run dev
```

Open http://127.0.0.1:47231. The file defaults to `backend: mock`.

## Live Home Assistant

```bash
cp config.example.demo-home.yaml config.local.yaml
```

Edit the entity ids, then:

```bash
BACKEND=homeassistant \
HA_URL=http://homeassistant.rhino-beaver.ts.net:8123 \
HA_TOKEN=your-token \
npm run dev
```

`HASS_TOKEN` is the same token under another name. The URL above is one Tailscale reach path. `HA_URL` can be any origin. The token is never stored in the repo.

Scenes are `scene.turn_on`. Room on and off are `light.turn_on` and `light.turn_off` on the room or zone entity, not each bulb.

## What you can say

| Say | Sample target | Call |
| --- | --- | --- |
| kitchen bright | `scene.example_kitchen_bright` | `scene.turn_on` |
| kitchen relax | `scene.example_kitchen_relax` | `scene.turn_on` |
| kitchen dim | `scene.example_kitchen_dim` | `scene.turn_on` |
| kitchen on / off | `light.example_kitchen` | `light.turn_on` / `light.turn_off` |
| living room bright | `scene.example_living_bright` | `scene.turn_on` |
| living room relax | `scene.example_living_relax` | `scene.turn_on` |
| living room on / off | `light.example_living_room` | light on / off |
| downstairs bright | `scene.example_downstairs_bright` | `scene.turn_on` |
| downstairs dim | `scene.example_downstairs_dim` | `scene.turn_on` |
| downstairs nightlight, goodnight | `scene.example_downstairs_nightlight` | `scene.turn_on` |
| movie lights, media room dim | `scene.example_media_dim` | `scene.turn_on` |
| media room on / off | `light.example_media_room` | light on / off |
| hallway sleep | `scene.example_hallway_sleep` | `scene.turn_on` |
| bedroom on / off | `light.example_bedroom` | light on / off |
| all lights off | `light.example_downstairs` and `light.example_upstairs` | `light.turn_off` after yes |
| outdoor on / off | `light.example_porch`, `light.example_path`, `light.example_garden` | light on / off together |
| dining room bright | `scene.example_dining_bright` | `scene.turn_on` |
| dining room on / off | `light.example_dining` | light on / off |
| entryway on / off | `light.example_entry` | light on / off |
| game room relax | `scene.example_game_relax` | `scene.turn_on` |
| game room on / off | `light.example_game_room` | light on / off |

Goodnight runs the downstairs nightlight and says there is no separate bedtime scene.

All lights off asks first, then turns off the two room lights. It does not call `switch.automation_all_lights_off`.

## Left off on purpose

These phrases are refused. They are not guessed into a nearby alias.

- movie night, theater
- bedtime
- dinner
- porch, patio
- away, home
- stock Hue formulas such as Energize and Arctic aurora

## Always denied

Even if someone pastes them into `config.local.yaml`, these never run:

- vehicle locks, covers, and climate
- garage-named lights and restart buttons
- alarms, sirens, and security panels
- cameras, including anything named like a gate camera
- thermostats and pool heaters
- water, sprinklers, and irrigation
- vacuums
- HVAC vents
- Hue schedule switches, including `switch.automation_all_lights_off`
- scripts

Home Assistant calls from this app are only `light.turn_on`, `light.turn_off`, and `scene.turn_on`.
