import Homey, { App } from 'homey';
import DriverUtils from './../DriverUtils'

module.exports = class MyCitroenDriver extends Homey.Driver {
  private brandName:string = "MyCitroen";

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(this.brandName + 'Driver has been initialized');
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return DriverUtils.getVehicles(this, this.brandName);
  }
};