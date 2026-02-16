import Homey from 'homey';
import StellantisClient from './Lib/Stellantis/src';


class StellantisApp extends Homey.App {
    
    private tokenRefreshInterval?: NodeJS.Timeout;
    private tokenManagers!:StellantisClient[];

    async onInit(): Promise<void> {
        this.log('Stellantis app has been initialized');

        this.tokenManagers = [
            new StellantisClient(this,"MyPeugeot"),  //MyPeugeot
            new StellantisClient(this,"MyCitroen"),  //MyCitroen
            new StellantisClient(this,"MyOpel"),  //MyOpel
            new StellantisClient(this,"MyDS"),  //MyDS
            new StellantisClient(this,"MyVauxhall")   //MyVauxhall
        ]
    }

    public getStellantisClient(brandName:string)
    {
        let tmi:number = 0;
        switch(brandName)
        {
            case "MyPeugeot":
                tmi=0;
                break;
            case "MyCitroen":
                tmi=1;
                break;
            case "MyOpel":
                tmi=2;
                break;
            case "MyDS":
                tmi=3;
                break;
            case "MyVauxhall":
                tmi=4;
                break;
        }
        return this.tokenManagers[tmi];
    }

    async onUninit(): Promise<void> {
        this.log('Stellantis app is shutting down');
        
        if (this.tokenRefreshInterval) {
            clearInterval(this.tokenRefreshInterval);
        }
    }
}

export = StellantisApp;