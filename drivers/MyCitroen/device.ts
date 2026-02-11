import Homey from 'homey';
import DeviceUtils from './../DeviceUtils'

module.exports = class MyCitroenDevice extends Homey.Device {
  private tokenRefreshInterval?:NodeJS.Timeout;
  private brandName:string = "MyCitroen";

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log(this.brandName + 'Device has been initialized');

    // Start token refresh checker (every minute)
    this.tokenRefreshInterval = setInterval(() => {
        this.checkAndRefreshData();
    }, 60 * 1000 * 15);

    //Wait 15 seconds before request data in order to get the correct token available
    setTimeout(() => {this.checkAndRefreshData();}, 1000 * 15)    
    
    let actionUpdateVehicle = this.homey.flow.getActionCard('updatevehiclestatus_' + this.brandName);
    actionUpdateVehicle.registerRunListener(async (args) => {
      await this.checkAndRefreshData();
      return true;
    });
  }

  async checkAndRefreshData() {
    DeviceUtils.checkAndRefreshData(this, this.brandName);
  }
  
  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log(this.brandName + 'Device has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log(this.brandName + 'Device settings where changed');
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log(this.brandName + 'Device was renamed');

    this.checkAndRefreshData();
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log(this.brandName + 'Device has been deleted');

    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }
  }
}
