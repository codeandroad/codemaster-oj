"""Original classroom sample: split a data file into six colour files."""

from pathlib import Path

COLOURS = ('Red', 'Green', 'Blue', 'Orange', 'Yellow', 'Pink')


def ReadData(filename='TheData.txt'):
    records = []
    for line in Path(filename).read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        try:
            value_text, colour_text = line.split(',', 1)
            colour = colour_text.strip().capitalize()
            if colour not in COLOURS:
                continue
            records.append((int(value_text.strip()), colour))
        except ValueError:
            continue
    return records


def SplitData(records):
    groups = {colour: [] for colour in COLOURS}
    for value, colour in records:
        groups[colour].append(value)
    return groups


def StoreData(groups):
    for colour in COLOURS:
        lines = ''.join(f'{value}\n' for value in groups[colour])
        with Path(f'{colour}.txt').open('a', encoding='utf-8') as target:
            target.write(lines)


if __name__ == '__main__':
    records = ReadData()
    StoreData(SplitData(records))
    print(f'Processed: {len(records)}')
