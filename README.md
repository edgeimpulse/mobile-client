# Edge Impulse Mobile acquisition and inferencing client

## Using this client

You don't need this repository. Just go to the **Devices** tab in Edge Impulse, click **Add a new device** and select **Mobile phone**. This pops up a QR code that you can scan with your phone. That's it!

## Developing with this client

Turns your mobile phone into a fully-supported client for [Edge Impulse](https://www.edgeimpulse.com). You can capture data from the accelerometer and microphone, verify your machine learning model, and run classification without leaving your browser. The easiest way to use this application is to head to the [Edge Impulse documentation: Mobile phone](https://docs.edgeimpulse.com/docs/using-your-mobile-phone).

## Installation

To build:

1. Install dependencies:

    ```
    $ npm install
    ```

1. Build the client:

    ```
    $ npm run watch
    ```

1. Run a web server:

    ```
    $ cd public
    $ python -m SimpleHTTPServer
    ```

1. You'll need to be connected over HTTPS to access sensors (at least on iPhone), use ngrok to open up your web browser to the world via:

    ```
    $ ngrok http 8000
    ```

Go to the HTTPS URL that ngrok printed to see the client.

## Attribution

The mobile client was built in conjunction with [Brian Weeteling](https://www.brianweet.com).
