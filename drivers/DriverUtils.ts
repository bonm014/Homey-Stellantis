import Homey from 'homey';
import {StellantisClient,Vehicle,TripDetail} from './../Lib/Stellantis/src'
import StellantisApp from './../app'

class DriverUtils {
  static async getVehicles(device:Homey.Driver, brandName:string) {
    let devices:any = [];

    let myApp = device.homey.app as StellantisApp;

    let client = await myApp.getStellantisClient(brandName);

    let vehicles:Vehicle[] = await client.getVehicles();

    vehicles.forEach((vehicle: Vehicle) => {
      console.log(`${vehicle.vin}`);

      console.log(vehicle.brand);

      if(vehicle.brand.toLowerCase() == brandName.replace("My","").toLowerCase())
      {
        devices.push({
            name: `${vehicle.vin}`,
            data: { id: vehicle.id, vin: vehicle.vin, motorization:vehicle.motorization, brand:vehicle.brand, picture:vehicle.pictures[0] },
            store: { id: vehicle.id, vin: vehicle.vin, motorization:vehicle.motorization, brand:vehicle.brand, picture:vehicle.pictures[0] },
        });
      }
    });

    return devices;
  }
}

export = DriverUtils
