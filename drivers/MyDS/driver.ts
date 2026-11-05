import Homey, { App } from 'homey';
import DriverUtils from './../DriverUtils'

module.exports = class MyCitroenDriver extends Homey.Driver {
  private brandName:string = "MyDS";

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log(this.brandName + 'Driver has been initialized');

    // Air conditioning (preconditioning) flow actions
    this.homey.flow.getActionCard('startairco_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.startAirco();
        return true;
      });

    this.homey.flow.getActionCard('stopairco_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.stopAirco();
        return true;
      });

    // Charging and wake-up flow actions
    this.homey.flow.getActionCard('startcharging_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.startCharging();
        return true;
      });

    this.homey.flow.getActionCard('stopcharging_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.stopCharging();
        return true;
      });

    // Conditions: is a remote service part of the subscription of this car?
    this.homey.flow.getConditionCard('remoteservice_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        return await args.device.hasRemoteService(args.service);
      });

    this.homey.flow.getConditionCard('servicecode_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        return await args.device.hasRemoteService(args.code);
      });

    // Doors, horn and lights flow actions (only work when the car supports them)
    this.homey.flow.getActionCard('lockdoors_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.lockDoors();
        return true;
      });

    this.homey.flow.getActionCard('unlockdoors_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.unlockDoors();
        return true;
      });

    this.homey.flow.getActionCard('horn_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.honkHorn();
        return true;
      });

    this.homey.flow.getActionCard('lights_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.flashLights();
        return true;
      });

    this.homey.flow.getActionCard('wakeup_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        await args.device.wakeUp();
        return true;
      });

    // Battery health (state of health): returns tokens for Advanced Flows
    this.homey.flow.getActionCard('getbatteryhealth_' + this.brandName.toLowerCase())
      .registerRunListener(async (args: any) => {
        return await args.device.getBatteryHealth();
      });
  }

  /**
   * onPairListDevices is called when a user is adding a device and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    return DriverUtils.getVehicles(this, this.brandName);
  }
};