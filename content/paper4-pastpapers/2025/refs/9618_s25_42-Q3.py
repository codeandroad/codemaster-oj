class Animal:
    def __init__(self, Name, Sound, Size, Intelligence):
        self.Name = Name  # string
        self.Sound = Sound  # string
        self.Size = Size  # integer
        self.Intelligence = Intelligence  # integer
    def Description(self):
        return f"The animal's name is {self.Name}, it makes a {self.Sound}, its size is {self.Size} and its intelligence level is {self.Intelligence}"

class Parrot(Animal):
    def __init__(self, Name, Sound, Size, Intelligence, WingSpan, NumberWords):
        super().__init__(Name, Sound, Size, Intelligence)
        self.WingSpan = WingSpan  # integer
        self.NumberWords = NumberWords  # integer
    def ChangeNumberWords(self, Change):
        self.NumberWords += Change
    def Description(self):
        return super().Description() + f". It has a wingspan of {self.WingSpan}cm and can say {self.NumberWords} words."

class Wolf(Animal):
    def __init__(self, Name, Sound, Size, Intelligence, TerritorySize):
        super().__init__(Name, Sound, Size, Intelligence)
        self.TerritorySize = TerritorySize  # integer
    def SetTerritorySize(self, Change):
        self.TerritorySize += Change
    def Description(self):
        return super().Description() + f". Its territory is {self.TerritorySize} square miles."

Chewie = Parrot("Chewie", "Squawk", 1, 10, 30, 29)
Nighteyes = Wolf("Nighteyes", "Howl", 8, 7, 100)
Copper = Animal("Copper", "Neigh", 10, 6)
Nighteyes.SetTerritorySize(-20)
Chewie.ChangeNumberWords(2)
for animal in [Chewie, Nighteyes, Copper]: print(animal.Description())
