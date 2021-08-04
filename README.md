# hero-heroku README

Hero Heroku is the (unofficial) Heroku counterpart to Microsoft's Azure Extension. The various Heroku extensions on the marketplace are just wrappers around the Heroku CLI/Wep Platform, which is where this extension shines! It attempts to be your Heroku Dashboard inside VSCode, by enabling you to manage your apps and their features without leaving the editor!

## Features

- Visual indicators of Dyno/App runtime status.
- Start, stop, and create Dynos.
- Scale your app horizontally.
- Add, modify and delete addons for apps.
- Check the build logs, ~~and open a console stream~~.
- ~~Quickly open one-off dynos, like bashing into your app.~~

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