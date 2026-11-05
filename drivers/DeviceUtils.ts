import Homey from 'homey';
import {StellantisClient,TripDetail} from './../Lib/Stellantis/src'
import StellantisApp from './../app'
import { isNumberObject } from 'util/types';

class DeviceUtils {
  static getCarId(device:Homey.Device):string {
    return device.getStoreValue('id');
  }

  static async setPicture(device:Homey.Device, picture:string) {
    if(picture != null && picture != undefined && picture != "")
    {
      try
      {
        const img = await device.homey.images.createImage();
        img.setUrl(picture);
        await device.setCameraImage('myCar', 'myCar', img);
      }
      catch{}
    }
  }

  static async setCapabilityValue(device:Homey.Device, key:string, value:any)
  {
    if(value == null || value == undefined)
    {
      if(await device.hasCapability(key))
      {
        await device.removeCapability(key);
      }

      return;
    }

    try
    {
      if(!await device.hasCapability(key))
      {
        await device.addCapability(key);
      }
      device.log(`${key} == ${value}`);
      await device.setCapabilityValue(key,value);
    }
    catch(error)
    {
      device.log(`${key}=${value}`)

      if(await device.hasCapability(key))
      {
        await device.removeCapability(key);
      }
    }
  }

  private static parsePtTime(value: any): { hour: number, minute: number } | null {
    const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value || ''));
    if (!match) {
      return null;
    }
    return { hour: parseInt(match[1] || '0', 10), minute: parseInt(match[2] || '0', 10) };
  }

  /**
   * The preconditioning programs that are currently set in the car. The car expects them to be
   * sent along with every start/stop, otherwise the schedules would be reset
   * (same as the Home Assistant integration; hour 34 = program not in use).
   */
  static getPreconditioningPrograms(vehicleStatus: any): { [key: string]: any } {
    const programs: { [key: string]: any } = {
      program1: { day: [0, 0, 0, 0, 0, 0, 0], hour: 34, minute: 7, on: 0 },
      program2: { day: [0, 0, 0, 0, 0, 0, 0], hour: 34, minute: 7, on: 0 },
      program3: { day: [0, 0, 0, 0, 0, 0, 0], hour: 34, minute: 7, on: 0 },
      program4: { day: [0, 0, 0, 0, 0, 0, 0], hour: 34, minute: 7, on: 0 }
    };

    const current = vehicleStatus?.preconditioning?.airConditioning?.programs;
    if (!Array.isArray(current)) {
      return programs;
    }

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const program of current) {
      if (!program || !program.occurence || !program.occurence.day || !program.start) {
        continue;
      }
      const time = DeviceUtils.parsePtTime(program.start);
      if (time == null) {
        continue;
      }
      programs['program' + program.slot] = {
        day: days.map(d => program.occurence.day.includes(d) ? 1 : 0),
        hour: time.hour,
        minute: time.minute,
        on: program.enabled ? 1 : 0
      };
    }

    return programs;
  }

  /**
   * Start or stop the air conditioning (preconditioning) of the car
   */
  static async sendPreconditioning(device:Homey.Device, brandName:string, start:boolean)
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const vin:string = device.getStoreValue('vin');
    if(!vin)
    {
      throw new Error(device.homey.__('errors.vin_unknown'));
    }

    const remoteClient = await client.getRemoteClient();
    if(remoteClient == null)
    {
      throw new Error(device.homey.__('errors.remote_unavailable'));
    }

    let programs = DeviceUtils.getPreconditioningPrograms(null);
    try
    {
      const vehicleStatus = await client.getVehicleStatus(DeviceUtils.getCarId(device));
      programs = DeviceUtils.getPreconditioningPrograms(vehicleStatus);
    }
    catch(error)
    {
      device.log('Unable to read the current preconditioning programs, using the defaults');
    }

    const action = start ? 'activate' : 'deactivate';
    device.log(`Send preconditioning ${action}`);

    const result = await remoteClient.sendRemoteCommand(vin, '/ThermalPrecond', { asap: action, programs: programs });
    if(!result.success)
    {
      throw new Error(device.homey.__(start ? 'errors.airco_start_failed' : 'errors.airco_stop_failed', { error: String(result.error) }));
    }

    device.log(`Preconditioning ${action} done`);
  }

  /**
   * Is a remote service (FDS code like NAS01) part of the subscription of this car?
   * Used by the "service is available" flow conditions.
   */
  static async hasRemoteService(device:Homey.Device, brandName:string, code:string):Promise<boolean>
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const vin:string = device.getStoreValue('vin');
    if(!vin)
    {
      throw new Error(device.homey.__('errors.vin_unknown'));
    }

    const wanted = String(code || '').trim().toUpperCase();
    if(!wanted)
    {
      throw new Error(device.homey.__('errors.service_code_missing'));
    }

    const services = await client.getVehicleRights(vin);
    return services.some(s => s.code.toUpperCase() === wanted);
  }

  /**
   * Send a simple remote command (no status needed) and throw a readable error when it fails.
   */
  private static async sendSimpleCommand(device:Homey.Device, brandName:string, service:string, params:any, label:string, failedKey:string)
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const vin:string = device.getStoreValue('vin');
    if(!vin)
    {
      throw new Error(device.homey.__('errors.vin_unknown'));
    }

    const remoteClient = await client.getRemoteClient();
    if(remoteClient == null)
    {
      throw new Error(device.homey.__('errors.remote_unavailable'));
    }

    device.log(`Send ${label}`);
    const result = await remoteClient.sendRemoteCommand(vin, service, params);
    if(!result.success)
    {
      throw new Error(device.homey.__(failedKey, { error: String(result.error) }));
    }

    device.log(`${label} done`);
  }

  static async sendDoors(device:Homey.Device, brandName:string, lock:boolean)
  {
    await DeviceUtils.sendSimpleCommand(device, brandName, '/Doors', { action: lock ? 'lock' : 'unlock' }, lock ? 'Lock doors' : 'Unlock doors', lock ? 'errors.doors_lock_failed' : 'errors.doors_unlock_failed');
  }

  static async sendHorn(device:Homey.Device, brandName:string)
  {
    await DeviceUtils.sendSimpleCommand(device, brandName, '/Horn', { nb_horn: '2', action: 'activate' }, 'Honk horn', 'errors.horn_failed');
  }

  static async sendLights(device:Homey.Device, brandName:string)
  {
    await DeviceUtils.sendSimpleCommand(device, brandName, '/Lights', { duration: '10', action: 'activate' }, 'Flash lights', 'errors.lights_failed');
  }

  /**
   * Start or stop charging, same as the Home Assistant integration:
   * there is no stop command; starting is type "immediate" and stopping is type "delayed",
   * both carrying the charging start time that is programmed in the car (nextDelayedTime).
   */
  static async sendCharging(device:Homey.Device, brandName:string, start:boolean)
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const vin:string = device.getStoreValue('vin');
    if(!vin)
    {
      throw new Error(device.homey.__('errors.vin_unknown'));
    }

    const remoteClient = await client.getRemoteClient();
    if(remoteClient == null)
    {
      throw new Error(device.homey.__('errors.remote_unavailable'));
    }

    const vehicleStatus:any = await client.getVehicleStatus(DeviceUtils.getCarId(device));
    const electric = (vehicleStatus?.energy || []).find((e:any) => e.type === 'Electric');
    const time = DeviceUtils.parsePtTime(electric?.charging?.nextDelayedTime);
    if(time == null)
    {
      throw new Error(device.homey.__('errors.charge_time_unknown'));
    }

    const type = start ? 'immediate' : 'delayed';
    device.log(`Send charging ${type}`);

    const result = await remoteClient.sendRemoteCommand(vin, '/VehCharge', { program: { hour: time.hour, minute: time.minute }, type: type });
    if(!result.success)
    {
      throw new Error(device.homey.__(start ? 'errors.charging_start_failed' : 'errors.charging_stop_failed', { error: String(result.error) }));
    }

    device.log(`Charging ${type} done`);
  }

  private static wakeupHistory:{ [vin:string]: number[] } = {};

  /**
   * Wake up the car (same "state" request the Home Assistant wake-up button sends) and refresh the status afterwards.
   * Limited to 6 per 20 minutes per car, like Home Assistant, to avoid draining the 12V battery.
   */
  static async sendWakeup(device:Homey.Device, brandName:string)
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const vin:string = device.getStoreValue('vin');
    if(!vin)
    {
      throw new Error(device.homey.__('errors.vin_unknown'));
    }

    const now = Date.now();
    const recent = (DeviceUtils.wakeupHistory[vin] || []).filter(t => now - t < 20 * 60 * 1000);
    if(recent.length >= 6)
    {
      throw new Error(device.homey.__('errors.wakeup_limit'));
    }

    const remoteClient = await client.getRemoteClient();
    if(remoteClient == null)
    {
      throw new Error(device.homey.__('errors.remote_unavailable'));
    }

    recent.push(now);
    DeviceUtils.wakeupHistory[vin] = recent;

    device.log('Send wakeup');
    const result = await remoteClient.sendRemoteCommand(vin, '/VehCharge/state', { action: 'state' });
    if(!result.success)
    {
      throw new Error(device.homey.__('errors.wakeup_failed', { error: String(result.error) }));
    }

    device.log('Wakeup done');
  }


  /**
   * The battery health (state of health) of the traction battery, when the car reports it.
   * The status holds it twice: energies[].extension.electric.battery.health and energy[].battery.health.
   */
  static getBatteryHealth(vehicleStatus:any):{ value:number, updatedAt?:string } | null
  {
    const candidates:any[] = [];

    for(const energy of Array.isArray(vehicleStatus?.energies) ? vehicleStatus.energies : [])
    {
      candidates.push(energy?.extension?.electric?.battery?.health);
    }
    for(const energy of Array.isArray(vehicleStatus?.energy) ? vehicleStatus.energy : [])
    {
      candidates.push(energy?.battery?.health);
    }

    for(const health of candidates)
    {
      if(health != null && typeof health.resistance === 'number' && !isNaN(health.resistance))
      {
        return { value: health.resistance, updatedAt: health.createdAt };
      }
    }

    return null;
  }

  /**
   * Flow action: reads the battery health from the car and returns it as tokens (Advanced Flow).
   */
  static async readBatteryHealth(device:Homey.Device, brandName:string)
  {
    const myApp = device.homey.app as StellantisApp;
    const client = myApp.getStellantisClient(brandName);

    const status = await client.getVehicleStatus(DeviceUtils.getCarId(device));
    const health = DeviceUtils.getBatteryHealth(status);
    if(health == null)
    {
      throw new Error(device.homey.__('errors.battery_health_unavailable'));
    }

    await DeviceUtils.setCapabilityValue(device, 'measure_battery_health', health.value);

    return {
      battery_health: health.value,
      battery_health_updated: health.updatedAt ? DeviceUtils.formatDate(device, new Date(health.updatedAt)) : ''
    };
  }

  static async checkTrips(device:Homey.Device,client:StellantisClient,carId:string, brandName:string)
  {
    device.log("check trips");
    var vehicleStatus = await client.getVehicleStatus(carId);

    //Skip the trips if we are still moving
    if(vehicleStatus != null && vehicleStatus.kinetic?.moving)
    {
      return;
    }

    var vehicleTrips = await client.getVehicleLastTrips(carId);
    if(vehicleTrips == null)
    {
      return;
    }
    let tripLastKnownDate:Date = await device.getStoreValue('tripLastKnownDate');

    let triggerNewTrip = device.homey.flow.getDeviceTriggerCard("newtrip_" + brandName.toLowerCase());

    let numOfNewTrips:number = vehicleTrips._embedded.trips.length;

    for(let i = 0 ; i < numOfNewTrips ; i++) {
      let trip:TripDetail = vehicleTrips._embedded.trips[i];

      if(trip.startedAt > tripLastKnownDate || tripLastKnownDate == null || tripLastKnownDate == undefined)
      {
        let energyConsumptions = null;
        if(trip.energyConsumptions.length > 0) {
          energyConsumptions = trip.energyConsumptions[0]
        }

        triggerNewTrip.trigger(device, {
          duration:trip.duration,
          distance:trip.distance,
          startedAt:trip.startedAt,
          stoppedAt:trip.stoppedAt,
          energyConsumption:energyConsumptions?.consumption || 0,
          energyConsumptionAvg:energyConsumptions?.avgConsumption || 0,
          SpeedAvg:trip.kinetic.avgSpeed
        });

        try
        {
          await device.setStoreValue('tripLastKnownDate', trip.startedAt);
        }
        catch(error) {}
      }
    }
  }

  
  static formatDate(device:Homey.Device,date: Date): string {
    const tz = device.homey.clock.getTimezone()

    const parts = new Intl.DateTimeFormat('nl-NL', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).formatToParts(new Date(date));

    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));

    const formatted = `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;

    return formatted;
  }


  /**
   * Writes the remote services (FDS codes) of the car to the advanced settings of the device,
   * so users can share them (for example to find out which cars support doors, horn or lights).
   * The VIN is left out on purpose.
   */
  static async updateServiceCodes(device:Homey.Device, client:StellantisClient)
  {
    let text:string;

    try
    {
      const vin:string = device.getStoreValue('vin');
      if(!vin)
      {
        return;
      }

      const services = await client.getVehicleRights(vin);
      text = JSON.stringify({
        brand: device.getStoreValue('brand'),
        motorization: device.getStoreValue('motorization'),
        services: services.map(s => ({ code: s.code, name: s.name, mqtt_services: s.mqtt_services }))
      }, null, 2);
    }
    catch(error)
    {
      text = `Unable to look up the remote services: ${(error as Error).message}`;
    }

    try
    {
      if(device.getSetting('debug_remoteservices') !== text)
      {
        await device.setSettings({ debug_remoteservices: text }); // schrijft naar Advanced settings
      }
    }
    catch(error)
    {
      device.log(`Unable to store the remote services in the settings: ${(error as Error).message}`);
    }
  }

  static async checkStatus(device:Homey.Device,client:StellantisClient,carId:string)
  {
    var vehicle = await client.getVehicle(carId);
    //device.log(vehicle);
    var vehicleStatus = await client.getVehicleStatus(carId);
    var vehicleMaintenance = await client.getVehicleMaintenance(carId);

    await device.setSettings({ debug_vehicle: JSON.stringify(vehicle, null, 2) }); // schrijft naar Advanced settings
    await device.setSettings({ debug_vehiclestatus: JSON.stringify(vehicleStatus,null,2) }); // schrijft naar Advanced settings
    await device.setSettings({ debug_vehiclemaintenance: JSON.stringify(vehicleMaintenance,null,2) }); // schrijft naar Advanced settings

    //console.dir(vehicleStatus, { depth: null });
    
    if(vehicleStatus != null)
    {
      DeviceUtils.setCapabilityValue(device, "measure_lastrefresh", this.formatDate(device, vehicleStatus.updatedAt));
    }

    if(vehicle != null && vehicle.pictures.length > 0)
    {
      let pIndex:number = Math.floor(Math.random() * (vehicle.pictures.length-1));
      await DeviceUtils.setPicture(device, vehicle.pictures[pIndex]);
    }
    
    //Remove the charging possibility
    DeviceUtils.setCapabilityValue(device,'evcharger_charging', null);

    if(vehicleMaintenance != null)
    {
      DeviceUtils.setCapabilityValue(device,'measure_maintenance_km', vehicleMaintenance.mileageBeforeMaintenance);
      DeviceUtils.setCapabilityValue(device,'measure_maintenance_days', vehicleMaintenance.daysBeforeMaintenance);
    }

    if(vehicleStatus !=  null)
    {
      DeviceUtils.setCapabilityValue(device,'measure_odometer_km', vehicleStatus.odometer?.mileage);

      //Battery health (state of health), only when the car reports it
      DeviceUtils.setCapabilityValue(device,'measure_battery_health', DeviceUtils.getBatteryHealth(vehicleStatus)?.value);

      DeviceUtils.setCapabilityValue(device,'measure_temperature', vehicleStatus.environment?.air.temp);

      DeviceUtils.setCapabilityValue(device,'fan_mode', null);

      if(vehicleStatus.preconditioning?.airConditioning?.status == "Disabled")
      {
        DeviceUtils.setCapabilityValue(device,'measure_airconditioning', false);
      }
      else
      {
        DeviceUtils.setCapabilityValue(device,'measure_airconditioning', true);
      }  

      switch(vehicleStatus.ignition?.type)
      {
        default:
        {
          if(vehicleStatus.kinetic?.moving)
          {
            DeviceUtils.setCapabilityValue(device,'operational_state', 'running');
          }
          else
          {
            DeviceUtils.setCapabilityValue(device,'operational_state', 'paused');
          }
          break;   
        }
        case "Stop":
        {
          DeviceUtils.setCapabilityValue(device,'operational_state', 'stopped');
          break;   
        }
      }
    }

    if(vehicleStatus != null && vehicleStatus.energy!.length > 0)
    {
      let energy = vehicleStatus.energy![0];
      DeviceUtils.setCapabilityValue(device,'measure_battery', energy.level);
      DeviceUtils.setCapabilityValue(device,'progress', null);
      
      DeviceUtils.setCapabilityValue(device,'measure_range_km', energy.autonomy);

      DeviceUtils.setCapabilityValue(device,'measure_voltage', vehicleStatus.battery?.voltage);

      if(vehicle != null && vehicle.motorization == 'Electric')
      {
        if(energy.charging?.plugged)
        {
          if(energy.charging?.chargingRate! > 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in_charging"); 
            //DeviceUtils.setCapabilityValue(device,'evcharger_charging', true);  
          }
          if(energy.charging?.chargingRate! < 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in_discharging");
            //DeviceUtils.setCapabilityValue(device,'evcharger_charging', true);  
          }
          if(energy.charging?.chargingRate! == 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in");  
            //DeviceUtils.setCapabilityValue(device,'evcharger_charging', false);  
          }
        }
        else
        {
          //DeviceUtils.setCapabilityValue(device,'evcharger_charging', false);  
          //DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_out");
        }
      }
    }
  }

  static async checkAndRefreshData(device:Homey.Device, brandName:string) {
    let myApp = device.homey.app as StellantisApp;

    device.log(`Refresh car details ${device.getStoreValue('vin')}`)
    let client = await myApp.getStellantisClient(brandName);

    var carId = DeviceUtils.getCarId(device);

    //Check status
    DeviceUtils.checkStatus(device,client,carId);

    //Remote services of the car (advanced settings)
    DeviceUtils.updateServiceCodes(device,client);

    //Check for new trips
    DeviceUtils.checkTrips(device,client, carId, brandName);
  }
}

export = DeviceUtils
