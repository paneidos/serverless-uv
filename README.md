# Serverless uv

This package will use uv to add your Python dependencies to your Serverless functions.
Made for [osls](https://github.com/oss-serverless/osls), works with Serverless v3 too.

## Installation

To use, add the package to your `package.json` and the plugin to `serverless.yml`.

```
yarn add --dev serverless-uv
```

`serverless.yml`:

```
plugins:
  - serverless-uv
```

## Configuration

The plugin is enabled by default for all functions, so you don't need to configure anything.
If you want to disable the plugin for a function, you can do so using the `uv` configuration object:

```
functions:
  hello:
    uv:
      enabled: false
```

_Note:_ the function is skipped if its runtime is not python.

You can also selectively enable uv for certain functions by disabling globally:

```
uv:
  enabled: false
```

## Architecture

Before creating your Python functions, this plugin creates a clean requirements.txt using `uv export`.
After packaging, it'll look through all of your functions and create a list of each runtime+architecture combination of your Python functions.
For each combination it'll create a layer that contains the dependencies for that version and architecture using `uv pip install`.
This layer is linked to your function automatically, so you'll always get the correct dependencies.

### Caveats

The current version uses `--no-build`, which means wheels for your target platform must be available.
As the only supported runtimes are built on Amazon Linux 2023, this means they'll use the `XXX_manylinux_2_34` variant,
which matches the supplied glibc version.
