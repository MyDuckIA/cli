# 🦆 My Duck

A CLI rubber duck for developers.

It asks questions.\
It never gives solutions.\
Ever.

------------------------------------------------------------------------

## Why?

You don't need another AI that writes code for you.

You need something that makes you think.

My Duck is not an assistant.\
It's a thinking partner.

------------------------------------------------------------------------

## What does it do?

You explain your problem.

It asks questions.

That's it.

No fixes.\
No copy/paste code.\
No implementation help.\
No "here's the solution".

Just better questions.

------------------------------------------------------------------------

## Demo

``` bash
$ myduck

You> My API is slow
Duck> What is the current bottleneck you can measure right now?

You> Just give me the fix
Duck> I am a plastic duck. I am not here to give the answer. What did you try already?
```

------------------------------------------------------------------------

## Install

### Local dev

``` bash
npm link
```

### Global install (after publish)

``` bash
npm install -g myduck
```

------------------------------------------------------------------------

## Prerequisites

Install at least one local provider CLI:

-   Claude CLI (`claude`)
-   Codex CLI (`codex`)

My Duck only uses provider CLIs installed on your machine.

No API key mode.\
No remote backend login mode.\
No cloud dependency.

Everything runs locally.

------------------------------------------------------------------------

## Login

``` bash
myduck login
```

Then choose your provider.

My Duck will: - use your local CLI - run it in non-interactive mode -
enforce question-only responses

------------------------------------------------------------------------

## Run

``` bash
myduck
```

When you launch `myduck`, it automatically starts a local backend daemon
(`myduckd`) using a Unix socket if needed.

You can override the socket path:

``` bash
export MYDUCKD_SOCKET="/custom/path.sock"
```

Force a provider:

``` bash
export MYDUCK_CLI_PROVIDER="claude-cli"
```

Override Claude model:

``` bash
export MYDUCK_CLAUDE_MODEL="sonnet"
```

Increase timeouts if needed:

``` bash
export MYDUCK_PROVIDER_TIMEOUT_MS=300000
export MYDUCK_BACKEND_TIMEOUT_MS=310000
```

------------------------------------------------------------------------

## The Rule (Non-Negotiable)

My Duck must never provide:

-   Direct solutions\
-   Final copy/paste code\
-   Full implementations

Any pull request that turns My Duck into a solution generator will be
rejected.

------------------------------------------------------------------------

## Philosophy

Copy/paste coding makes you weaker.\
Instant answers kill deep understanding.\
Debugging is thinking.

Explaining your problem clearly often solves it.

My Duck just makes sure you do that part.

------------------------------------------------------------------------

## Why a duck?

Because a duck never solves your problem.

But explaining it to one usually does.

------------------------------------------------------------------------

## Contributing

Contributions are welcome.

Allowed: - Better questions - Better CLI UX - Provider improvements -
More personality

Not allowed: - Anything that gives direct answers - Anything that
generates final code

Keep the duck a duck.

------------------------------------------------------------------------

## License

MIT
