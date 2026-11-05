Do you want to stay up to date with your car, and control it remotely?
This app is for owners of Stellantis vehicles (Peugeot, Citroën, DS and Opel). It gives you insight into your car and lets you send commands to it.

Insight:
- Battery percentage, range, odometer and maintenance (days and kilometres).
- Battery health (state of health), if your car reports it. The Flow action "Get battery health" returns it as a token; tokens from actions can only be used in Advanced Flows.
- A trigger for a new trip, with the consumption, distance and duration of the trip.

Remote commands (Flow actions):
- Start and stop the air conditioning (preconditioning).
- Start and stop charging. Note: "Stop charging" postpones the start to the programmed charging time; the car has no real stop command.
- Wake up the car and refresh its status. Useful because the car sends no progress while charging. Limited to 6 per 20 minutes.
- Lock and unlock the doors, honk the horn and flash the lights.
- Update the vehicle status on demand.

Not every car supports every command. What is available depends on your model and your connected services subscription. Use the Flow conditions "Remote service is available" and "Service code is available" to check this before a command is sent. Commands that your car does not support fail with a clear message. Starting the air conditioning has been tested on a Peugeot; the other commands are new and may not work on every car.

Configuration:
Open the app settings on a PC/browser and follow the steps:
1. Choose your brand and country.
2. Log in to your account.
3. Complete the token step.
4. Confirm with a one-time password (OTP) sent by SMS and your PIN. This is needed for remote commands. You can skip it if you only want to read data.
You can also start directly with "Request OTP" or "Refresh OTP" from the start screen. The OTP service allows 6 requests per 24 hours, so do not request more than needed.

Support for other cars:
The service codes of your car are shown in the advanced settings of the device ("Remote services of this car"). Please share that text if you want support for more cars. It contains no VIN.

Credits:
andreadegiovine on github for his Home Assistant integration
