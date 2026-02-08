import Homey, { App } from 'homey';
import {StellantisApiClient,Vehicle} from './../../Lib/Stellantis/src'
import StellantisApp from './../../app'

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    let devices:any = [];

    let myApp = this.homey.app as StellantisApp;

    let myClient = await myApp.getStellantisClient();

    var client:StellantisApiClient = new StellantisApiClient(this.homey.app, await myClient.getAccessToken(), myClient.brand, myClient.country,myClient.clientid);

    let vehicles:Vehicle[] = await client.getVehicles();
    this.log(vehicles);

    vehicles.forEach((vehicle: Vehicle) => {
      console.log(`${vehicle.vin}`);

      devices.push({
          name: `__${vehicle.vin}`,
          data: { id: vehicle.id, vin: vehicle.vin, motorization:vehicle.motorization, brand:vehicle.brand, picture:vehicle.pictures[0] },
          store: { id: vehicle.id, vin: vehicle.vin, motorization:vehicle.motorization, brand:vehicle.brand, picture:vehicle.pictures[0] },
      });
    });

    return devices;
  }
};
