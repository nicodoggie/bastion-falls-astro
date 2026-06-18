# Early Hick MBROLA PHO Sources

These are the MBROLA `it2` `.pho` pronunciation sources used for the Early Hick
Chatterbox VC experiments. The generated WAVs are intentionally not committed;
render them locally and then pass the WAVs through Chatterbox VC.

Render one file:

```sh
mbrola /usr/share/mbrola/it2/it2 \
  docs/tts/mbrola/early-hick/it2-tail/confirmed/core/bris.pho \
  /tmp/bris.wav
```

Render a whole set:

```sh
mkdir -p /tmp/early-hick-rendered
for pho in docs/tts/mbrola/early-hick/it2-tail/confirmed/core/*.pho; do
  name="$(basename "$pho" .pho)"
  mbrola /usr/share/mbrola/it2/it2 "$pho" "/tmp/early-hick-rendered/$name.wav"
done
```

## Sets

Use `it2-tail` as the canonical base family.

- `it2-tail/confirmed/core/`: the first good Italian-tail pronunciation set.
- `it2-tail/confirmed/tormater/`: confirmed `tor-ma-ter` fixes; `t_long` is the cleaner default,
  and `t_preclosure` is the stronger articulation option.
- `it2-tail/probes/dental-glottal/`: focused dental-fricative and glottal-boundary tests.
- `it2-tail/probes/phonotactics-coverage/`: broader coverage from the Early Hick reference grammar.
- `it2-tail/probes/tormater-comparison/`: non-preferred but renderable `tor-ma-ter` comparison
  variants.

Promotion rule: keep new material under `it2-tail/probes/` until it has been listened to and chosen.
Move only confirmed-good `.pho` files into `it2-tail/confirmed/`.

Phrase-level material should stay in probes for now. The first connected phrase tests still sounded
robotic after Chatterbox conversion, so the confirmed set should focus on single words until the
phrase prosody problem is solved.

## Intentional Omissions

- `ketor_no_schwa.pho` is omitted because the old `it2` render was a broken partial.
- `tor_ma_ter_t_geminate_preclosure.pho` is omitted because MBROLA `it2` cannot render the
  combined `_-TT` segment.

## Approximation Notes

MBROLA `it2` does not cover the full Early Hick phonological inventory:

- `/theta/` is approximated with `S`.
- Glottal stop is approximated with a short `_` silence.
- `/h/` is approximated with a short `_` boundary.
- Schwa is approximated with shorter, lower-prominence `A`.
