import Homey, { App } from 'homey';
import DriverUtils from './../DriverUtils'
import StellantisClient from './../../Lib/Stellantis/src';
import StellantisApp from './../../app'

module.exports = class MyPeugeotDriver extends Homey.Driver {
  private brandName:string = "MyPeugeot";

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(this.brandName + 'Driver has been initialized');

    if(false)
    {
      let myApp = this.homey.app as StellantisApp;

      let client = await myApp.getStellantisClient(this.brandName);

      client.clearConfig();
    }
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return DriverUtils.getVehicles(this, this.brandName);
  }
};