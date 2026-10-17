class Bird:
    def __init__(self, DistancePerHour, Species):
        self.__Species = Species  # string
        self.__DistancePerHour = DistancePerHour  # real
        self.__XPosition = 500.0  # real
        self.__YPosition = 500.0  # real
    def GetSpecies(self): return self.__Species
    def GetPosition(self): return f"X = {self.__XPosition} Y = {self.__YPosition}"
    def Move(self, Direction, Minutes):
        Distance = self.__DistancePerHour / 60 * Minutes
        if Direction == "N": self.__YPosition += Distance
        elif Direction == "S": self.__YPosition -= Distance
        elif Direction == "E": self.__XPosition += Distance
        elif Direction == "W": self.__XPosition -= Distance

Cockatiel = Bird(71.0, "Cockatiel")
Macaw = Bird(56.0, "Macaw")
for TheBird in [Cockatiel, Macaw]: print(TheBird.GetSpecies(), TheBird.GetPosition())
Selected = input("Choose Cockatiel or Macaw: ")
while Selected not in ["Cockatiel", "Macaw"]:
    Selected = input("Choose Cockatiel or Macaw: ")
Direction = input("Direction N/S/E/W: ")
while Direction not in ["N", "S", "E", "W"]:
    Direction = input("Direction N/S/E/W: ")
while True:
    try:
        Minutes = int(input("Minutes 0 to 500: "))
        if 0 <= Minutes <= 500: break
    except ValueError:
        pass
TheBird = Cockatiel if Selected == "Cockatiel" else Macaw
TheBird.Move(Direction, Minutes)
print(TheBird.GetSpecies(), TheBird.GetPosition())
