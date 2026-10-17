class Train:
    def __init__(self, TrainIDNumber, Route):
        self.__TrainIDNumber = TrainIDNumber  # string
        self.__Route = Route  # integer
    def GetTrainIDNumber(self): return self.__TrainIDNumber
    def GetRoute(self): return self.__Route

class Station:
    def __init__(self, StationID, NumberPlatforms):
        self.__StationID = StationID  # string
        self.__NumberPlatforms = NumberPlatforms  # integer
        self.__Trains = [None] * 10  # array of Train
        self.__NumberTrains = 0  # integer
    def AddTrain(self, TheTrain):
        if self.__NumberTrains >= self.__NumberPlatforms: return False
        self.__Trains[self.__NumberTrains] = TheTrain
        self.__NumberTrains += 1
        return True
    def GetTrains(self):
        if self.__NumberTrains == 0: return "There are no trains"
        Text = "The trains at station " + self.__StationID + " are:"
        for i in range(self.__NumberTrains):
            TrainObject = self.__Trains[i]
            Text += "\n" + TrainObject.GetTrainIDNumber() + " on route number " + str(TrainObject.GetRoute())
        return Text

Train1 = Train("12ADV", 134)
Train2 = Train("33ART", 20)
Train3 = Train("9FKF", 3)
Train4 = Train("21VBC", 24)
South = Station("STH", 2)
North = Station("NTH", 1)
for TrainObject, StationObject in [(Train1, South), (Train2, South), (Train3, South), (Train4, North)]:
    if not StationObject.AddTrain(TrainObject): print("Station is full")
print(South.GetTrains())
print(North.GetTrains())
