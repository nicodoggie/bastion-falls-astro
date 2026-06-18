# Early Hick MBROLA to Chatterbox VC Recipe

This is the working recipe from the Early Hick voice test where MBROLA provides
the pronunciation/prosody and Chatterbox VC transfers it onto a more natural
reference voice.

## Result

The best current chain is:

1. Generate pronunciation with MBROLA `it2` using the tail-padded sources.
2. Exclude the broken partial `ketor_no_schwa.wav` render.
3. Use Chatterbox VC with the cute reference sample as the target voice.

The generated set that sounded good is:

```text
/tmp/early-hick-chatterbox-vc/it2-tail-cute-sample/
```

Manifest:

```text
/tmp/early-hick-chatterbox-vc/it2-tail-cute-sample/chatterbox-vc-it2-tail-cute-sample-manifest.json
```

## Inputs

Pronunciation/prosody source WAVs:

```text
/tmp/early-hick-mbrola-it2-tail/wav/
```

Regenerate those WAVs from the confirmed repo sources:

```sh
mkdir -p /tmp/early-hick-mbrola-it2-tail/wav
for pho in docs/tts/mbrola/early-hick/it2-tail/confirmed/core/*.pho; do
  name="$(basename "$pho" .pho)"
  mbrola /usr/share/mbrola/it2/it2 "$pho" "/tmp/early-hick-mbrola-it2-tail/wav/$name.wav"
done
```

Repo-local MBROLA `.pho` sources:

```text
docs/tts/mbrola/early-hick/
```

Confirmed `it2-tail` base sources:

```text
docs/tts/mbrola/early-hick/it2-tail/confirmed/core/
```

Target voice sample:

```text
/home/ensu/Projects/sml/runpod-tts-api/ref_audio/sample.mp3
```

Converted target voice reference:

```text
/tmp/early-hick-vc-targets/cute-sample-reference.wav
```

Chatterbox venv:

```text
/tmp/bf-chatterbox-venv
```

## Reference Conversion

Convert the MP3 reference to mono WAV before passing it to Chatterbox:

```sh
mkdir -p /tmp/early-hick-vc-targets
ffmpeg -hide_banner -y \
  -i /home/ensu/Projects/sml/runpod-tts-api/ref_audio/sample.mp3 \
  -ac 1 -ar 16000 \
  /tmp/early-hick-vc-targets/cute-sample-reference.wav
```

The tested reference was 16 kHz mono, 8.712s. Chatterbox writes generated audio
at 24 kHz.

## Chatterbox Batch

Run this from anywhere after the venv is installed:

```sh
/tmp/bf-chatterbox-venv/bin/python - <<'PY'
import json
import subprocess
from pathlib import Path

import torch
import torchaudio as ta
from chatterbox.vc import ChatterboxVC

source_dir = Path('/tmp/early-hick-mbrola-it2-tail/wav')
target = Path('/tmp/early-hick-vc-targets/cute-sample-reference.wav')
out_dir = Path('/tmp/early-hick-chatterbox-vc/it2-tail-cute-sample')
out_dir.mkdir(parents=True, exist_ok=True)

names = ['ba', 'bar', 'barakter', 'bramis', 'branthral_approx', 'bris']
device = 'cuda' if torch.cuda.is_available() else 'cpu'
model = ChatterboxVC.from_pretrained(device=device)

manifest = {
    'source_dir': str(source_dir),
    'target_voice_path': str(target),
    'output_dir': str(out_dir),
    'device': device,
    'model_sr': model.sr,
    'items': [],
}

def probe(path: Path):
    raw = subprocess.check_output([
        'ffprobe', '-v', 'error',
        '-show_entries', 'stream=sample_rate,channels',
        '-show_entries', 'format=duration,size',
        '-of', 'json', str(path),
    ], text=True)
    return json.loads(raw)

for name in names:
    src = source_dir / f'{name}.wav'
    out = out_dir / f'{name}-it2-tail-to-cute-sample.wav'
    wav = model.generate(str(src), target_voice_path=str(target))
    ta.save(str(out), wav, model.sr)
    manifest['items'].append({
        'name': name,
        'source': str(src),
        'target_voice_path': str(target),
        'output': str(out),
        'source_probe': probe(src),
        'output_probe': probe(out),
    })

manifest_path = out_dir / 'chatterbox-vc-it2-tail-cute-sample-manifest.json'
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(f'wrote {manifest_path}')
PY
```

Expected Chatterbox warnings in this setup:

- unauthenticated Hugging Face requests
- `pkg_resources` deprecation from `perth`
- diffusers LoRA deprecation
- `Reference mel length is not equal to 2 * reference token length`

Those warnings did not prevent valid output in the tested run.

## Verified Output Durations

```text
ba-it2-tail-to-cute-sample.wav                 0.340s
bar-it2-tail-to-cute-sample.wav                0.460s
barakter-it2-tail-to-cute-sample.wav           0.740s
bramis-it2-tail-to-cute-sample.wav             0.700s
branthral_approx-it2-tail-to-cute-sample.wav   0.780s
bris-it2-tail-to-cute-sample.wav               0.580s
```

`bris` is the important cutoff check. The source was `0.580125s` and the output
was `0.580000s`, so this run did not reproduce the earlier final-`s` truncation.

## Phonotactics Coverage Batch

For broader Early Hick phonotactics testing, use the current reference grammar at:

```text
astro/src/content/docs/world/languages/hickic/seneran/early-hick/index.mdx
```

The first coverage batch from that source is:

```text
/tmp/early-hick-mbrola-it2-phonotactics-coverage/
/tmp/early-hick-chatterbox-vc/it2-phonotactics-coverage-cute-sample/
```

Manifests:

```text
/tmp/early-hick-mbrola-it2-phonotactics-coverage/mbrola-it2-phonotactics-coverage-manifest.json
/tmp/early-hick-chatterbox-vc/it2-phonotactics-coverage-cute-sample/chatterbox-vc-it2-phonotactics-coverage-cute-sample-manifest.json
```

This batch covers:

- initial clusters: `br-`, `dr-`, `tr-`, `kr-`, `fl-`, `pl-`, `kl-`, `th-/θr-`, `gn-`, `kn-`
- final clusters: `-st`, `-sk`, `-sp`, `-ks`, `-ls`, `-rs`
- diphthongs and fossil vowel sequences: `ai`, `ei`, `kees`, `thraes`, `braes`
- glottal examples: `'al`, `'el`, `wak'eth`, `'u'u`, `ven'er`
- compound/prosody examples: `thral-kel`, `tor-ma-ter`, `bram-ma-ter`, `bramal`, `thragral`
- the heavy-coda repair `trask-'er -> tras-ker`

Known MBROLA `it2` approximations:

- `/θ/` is approximated with `T`, not `S`; the `S` source made the Chatterbox output too obviously sibilant.
- `/ʔ/` is approximated with a short `_` silence, currently lengthened enough to keep forms like `ven'er` from blurring into repeated syllables.
- `/h/` is approximated with a short `_` boundary because `it2` has no `h` phone.
- `/ə/` is approximated by shorter, lower-prominence `A`; `it2` has no schwa phone.

The generator inserted a 25ms boundary when `it2` lacked a required diphone. In this batch, only
`tors` and `tor_ma_ter` needed that repair, both for `T-O`.

### `tor-ma-ter` T Correction

In the first coverage batch, `tor_ma_ter` could make the `t` in `ter` sound too voiced after
Chatterbox conversion. The issue appears to come from a weak short Italian `T` in the MBROLA source,
which Chatterbox can preserve as a `d`-like onset.

Comparison set:

```text
/tmp/early-hick-mbrola-it2-tormater-fix/
/tmp/early-hick-chatterbox-vc/it2-tormater-fix-cute-sample/
```

Preferred correction variants:

```text
tor_ma_ter_t_long-to-cute-sample.wav
tor_ma_ter_t_preclosure-to-cute-sample.wav
```

Use `t_long` as the cleaner default correction: lengthen the `T` onset in `ter`.
Use `t_preclosure` when the `t` needs to be more clearly separated from the preceding vowel.

Rejected/limited variant:

```text
tor_ma_ter_t_geminate_preclosure
```

MBROLA `it2` cannot render the combined preclosure plus `TT` variant because the `_-TT` segment is
unsupported.

### Connected Phrase Experiment

Longer phrases sounded robotic when every word boundary was rendered as a hard MBROLA pause. Two
connected-speech profiles were tested, but neither was good enough to promote:

```text
/tmp/early-hick-mbrola-it2-tail-relevant-tests-connected/
/tmp/early-hick-chatterbox-vc/it2-tail-relevant-tests-connected-cute-sample/
```

Profiles tested:

```text
smooth
legato
```

Both remained too robotic for longer phrases. For now, keep confirmed `.pho` sources focused on
single words and short lexical forms. Revisit phrase generation only after finding a better prosody
strategy than simple MBROLA boundary shortening.
