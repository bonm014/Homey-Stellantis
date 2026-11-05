import Homey from 'homey';
import {StellantisClient,Vehicle,TripDetail} from './../Lib/Stellantis/src'
import StellantisApp from './../app'

class DriverUtils {
  private static brandnames: { [key: string]: string[] } = {
    "MyPeugeot":["peugeot"],
    "MyCitroen":["citroen","citroën"],
    "MyDS":["ds","ds automobiles"],
    "MyOpel":["opel","vauxhall"]
  }

  static async getVehicles(device:Homey.Driver, brandName:string) {
    let devices:any = [];

    let myApp = device.homey.app as StellantisApp;

    let client:StellantisClient | undefined = undefined;
    let vehicles:Vehicle[]
    try
    {
      client = await myApp.getStellantisClient(brandName);
      if(client.accessToken == "" || client.accessToken == null || client.accessToken == undefined)
      {
        throw("Please login first, no access token found");
      }
      vehicles = await client!.getVehicles();
    }
    catch(error)
    {
      throw(`Unable to get the vehicles: ${error}`);
    }

    let driverBrandnames = this.brandnames[brandName];
    
    vehicles.forEach((vehicle: Vehicle) => {
      device.log(`${vehicle.brand} - ${vehicle.vin}`);

      //Get the brandname in lowercase
      let vehiclebrand = (vehicle.brand + "").toLowerCase();

      //Check if the brandname is within the driver brand we are searching
      let containsBrandname = driverBrandnames.some(b => b.toLowerCase() === vehiclebrand);

      //Check if we should show the vehicle for this brand
      if(vehicle.brand == null || vehicle.brand == undefined || containsBrandname)
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
