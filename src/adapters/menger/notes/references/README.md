# cssMenger references

The source authority is XScreenSaver `menger` 6.15 at mirror commit
`906693799e4fb7581436590cf84ecb2d3c9186ba`.

`source-lock.json` binds 18 files covering the primary generator, color/HSV,
random sequence, rotator, trackball/quaternion support, adapter interface,
configuration, and manual. No upstream source is vendored here.

Verify a checkout with:

```sh
node tools/verify-provenance.mjs \
  --source-root /path/to/xscreensaver
```

The verifier checks the exact Git commit, tree, file sizes, SHA-256 hashes, and
Git blob identities. A successful check proves source identity only; it is not
a native build, browser render, or parity result.

Keep checkouts, builds, captures, traces, and frame sequences under `.local/`
or another ignored local path.
