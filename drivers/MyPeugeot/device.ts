import Homey from 'homey';
import {StellantisApiClient,Vehicle} from './../../Lib/Stellantis/src'
import StellantisApp from './../../app'

module.exports = class MyDevice extends Homey.Device {

  private tokenRefreshInterval?:NodeJS.Timeout;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.log('MyDevice has been initialized');

    // Start token refresh checker (every minute)
    this.tokenRefreshInterval = setInterval(() => {
        this.checkAndRefreshData();
    }, 60 * 1000 * 15);

    this.checkAndRefreshData();
    
    let actionUpdateVehicle = this.homey.flow.getActionCard('updateVehicleStatus');
    actionUpdateVehicle.registerRunListener(async (args) => {
      await this.checkAndRefreshData();
      return true;
    });
  }

  async checkAndRefreshData() {
    let myApp = this.homey.app as StellantisApp;

    this.log(`Refresh car details ${this.getStoreValue('vin')}`)
    let myClient = await myApp.getStellantisClient();

    var client:StellantisApiClient = new StellantisApiClient(this.homey.app, await myClient.getAccessToken(), myClient.brand, myClient.country,myClient.clientid);

    var vehicleStatus = await client.getVehicleStatus(this.getStoreValue('id'));
    var vehicleMaintenance = await client.getVehicleMaintenance(this.getStoreValue('id'));
    
    if (!this.hasCapability('measure_maintenance_km')) {
      await this.addCapability('measure_maintenance_km');
    }
    if (!this.hasCapability('measure_maintenance_days')) {
      await this.addCapability('measure_maintenance_days');
    }

    await this.setCapabilityValue('measure_maintenance_km', vehicleMaintenance.mileageBeforeMaintenance);
    await this.setCapabilityValue('measure_maintenance_days', vehicleMaintenance.daysBeforeMaintenance);

    await this.setCapabilityValue('measure_voltage', vehicleStatus.battery?.voltage);
    await this.setCapabilityValue('measure_battery', vehicleStatus.energy![0].level);
    
    await this.setCapabilityValue('measure_range_km', vehicleStatus.energy![0].autonomy);
    await this.setCapabilityValue('measure_odometer_km', vehicleStatus.odometer?.mileage);
    await this.setCapabilityValue('ev_charging_state', "plugged_out");

    
    var picture = await this.getStoreValue('picture');
    if(picture != null) {
      const img = await this.homey.images.createImage();
      img.setUrl(picture);
      this.setCameraImage('myPhoto', 'Actuele foto', img);
    }

    if(vehicleStatus.energy![0].charging?.plugged)
    {
      if(vehicleStatus.energy![0].charging?.chargingRate! > 0)
      {
        await this.setCapabilityValue('ev_charging_state', "plugged_in_charging");  
      }
      if(vehicleStatus.energy![0].charging?.chargingRate! < 0)
      {
        await this.setCapabilityValue('ev_charging_state', "plugged_in_discharging");  
      }
      if(vehicleStatus.energy![0].charging?.chargingRate! == 0)
      {
        await this.setCapabilityValue('ev_charging_state', "plugged_in");  
      }
    }
    else
    {
      await this.setCapabilityValue('ev_charging_state', "plugged_out");
    }
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.log('MyDevice has been added');
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
    this.log("MyDevice settings where changed");
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('MyDevice was renamed');

    this.checkAndRefreshData();
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    this.log('MyDevice has been deleted');

    if (this.tokenRefreshInterval) {
      clearInterval(this.tokenRefreshInterval);
    }
  }

};
