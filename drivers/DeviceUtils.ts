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

  static async StartStopCharging(device:Homey.Device, brandName:string, start:boolean)
  {
    /*
    let myApp = device.homey.app as StellantisApp;

    let myClient = await myApp.getStellantisClient(brandName);

    var client:StellantisApiClient = new StellantisApiClient(device.homey.app, await myClient.getAccessToken(), myClient.brand, myClient.country,myClient.clientid);
    var remoteClient:StellantisRemoteClient = new StellantisRemoteClient({
      accessToken: await myClient.getAccessToken(),
      clientId: myClient.clientid,
      clientSecret: myClient.clientSecret,
      countryCode: myClient.country,
      customerId: "",
      realm:`clientsB2C${brandName.replace('My', '')}`
    })
    var carId = DeviceUtils.getCarId(device);

    if(start)
    {
      //client.startCharging(carId);
    }
    else
    {
      //client.stopCharging(carId);
    }
      */
  }


  static async checkTrips(device:Homey.Device,client:StellantisClient,carId:string, brandName:string)
  {
    device.log("check trips");
    var vehicleTrips = await client.getVehicleLastTrips(carId);
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

  static async checkStatus(device:Homey.Device,client:StellantisClient,carId:string)
  {
    var vehicle = await client.getVehicle(carId);
    //device.log(vehicle);
    var vehicleStatus = await client.getVehicleStatus(carId);
    var vehicleMaintenance = await client.getVehicleMaintenance(carId);

    if(vehicle.pictures.length > 0)
    {
      let pIndex:number = Math.floor(Math.random() * (vehicle.pictures.length-1));
      await DeviceUtils.setPicture(device, vehicle.pictures[pIndex]);
    }
    
    if(vehicleMaintenance.mileageBeforeMaintenance != undefined)
    {
      DeviceUtils.setCapabilityValue(device,'measure_maintenance_km', vehicleMaintenance.mileageBeforeMaintenance);
    }
    if(vehicleMaintenance.daysBeforeMaintenance != undefined)
    {
      DeviceUtils.setCapabilityValue(device,'measure_maintenance_days', vehicleMaintenance.daysBeforeMaintenance);
    }

    DeviceUtils.setCapabilityValue(device,'measure_odometer_km', vehicleStatus.odometer?.mileage);

    if(vehicleStatus.energy!.length > 0)
    {
      let energy = vehicleStatus.energy![0];
      DeviceUtils.setCapabilityValue(device,'measure_battery', energy.level);
      DeviceUtils.setCapabilityValue(device,'measure_range_km', energy.autonomy);

      if(vehicle.motorization == 'Electric')
      {
        DeviceUtils.setCapabilityValue(device,'measure_voltage', vehicleStatus.battery?.voltage);
        DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_out");

        if(energy.charging?.plugged)
        {
          if(energy.charging?.chargingRate! > 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in_charging"); 
            DeviceUtils.setCapabilityValue(device,'evcharger_charging', true);  
          }
          if(energy.charging?.chargingRate! < 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in_discharging");
            DeviceUtils.setCapabilityValue(device,'evcharger_charging', true);  
          }
          if(energy.charging?.chargingRate! == 0)
          {
            DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_in");  
            DeviceUtils.setCapabilityValue(device,'evcharger_charging', false);  
          }
        }
        else
        {
          DeviceUtils.setCapabilityValue(device,'evcharger_charging', false);  
          DeviceUtils.setCapabilityValue(device,'ev_charging_state', "plugged_out");
        }
      }
    }
  }

  static async checkAndRefreshData(device:Homey.Device, brandName:string) {
    let myApp = device.homey.app as StellantisApp;

    device.log(`Refresh car details ${device.getStoreValue('vin')}`)
    let client = await myApp.getStellantisClient(brandName);

    var carId = DeviceUtils.getCarId(device);

    //Check for new trips
    DeviceUtils.checkTrips(device,client, carId, brandName);

    //Check status
    DeviceUtils.checkStatus(device,client,carId);
  }
}

export = DeviceUtils
