# ⚠️ OUTDATED ⚠️

> [Heroku is no longer free.](https://help.heroku.com/RSBRUH58/removal-of-heroku-free-product-plans-faq)
> 
> This makes me sad. ☹️
> 
> [A new challenger: Render](https://render.com/render-vs-heroku-comparison)
> 
> I am changed anew.

This extension is no longer under active development. Since Heroku removed their free tier, and their overall trajectory business-wise, I don't feel confident with their services anymore. After looking around for an alternative IaaS provider that could come close, I stumbled upon Render which answered all my questions (and more!).

While I keep tinkering with their systems, I'll start to gain an understanding of how they work and begin to build an extension to do the same things.

I enjoyed making Hero Heroku, but unfortunately with no motivation to continue making it, I don't plan on continuing the development. If converting this extension from Heroku to Render allows for a level of abstraction, I may return to developing this, but no promises.

Find my Render Extension here: (haha -- not yet...)

---

![Hero Banner](./res/hero-heroku-banner.png)

# Hero Heroku

Hero Heroku is the (unofficial) Heroku counterpart to Microsoft's Azure Extension. The various Heroku extensions on the marketplace are just wrappers around the Heroku CLI/Wep Platform, which is where this extension shines! It attempts to be your Heroku Dashboard inside VSCode, by enabling you to manage your apps and their features without leaving the editor!

![Hero Heroku gif](./res/hero-heroku.gif)

## Features

- Visual indicators of Dyno/App runtime status.
- Start, stop, and create Dynos.
- Scale your app horizontally.
- Add, modify and delete addons for apps.
- ~~Check the build logs~~, and open an app log stream.
- Quickly open one-off dynos, like bashing into your app.

## Requirements

The only requirement is to have the Heroku CLI installed, but it's only needed to create an Authentication Token. So techincally, it can be bypassed, by going to your Heroku account settings and generating a token on the web and copying it into VSCode. Everything else is conducted through the Web Platform API.

## Extension Settings

There are two settings which are available:

* `hero-heroku.apiKey`: your personal API key generated from the CLI or Account Settings page.
* `hero-heroku.apiCalls`: determines how many extension refreshes occur every minute.

## Known Issues

Find them? Try fix them! 🥳

## Roadmap

See [TODO.md](./TODO.md).

## Release Notes

See [CHANGELOG.md](./CHANGELOG.md).