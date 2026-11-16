// Transcribed from the user's 2025.zip. Original question and mark scheme PDFs
// remain in the private import package. Online answer controls retain question numbers.
const field=(id,label,multiline=false)=>({id,label,multiline});
const point=(text,auto)=>({text,maxMarks:1,...(auto?{auto}: {})});
const auto=(name,accepted,normalization='exact')=>({field:name,accepted,normalization});
const questions=[];
function question(id,label,marks,pages,statement,fields,points,guidance='Award one mark per valid point, up to the question maximum. Accept valid equivalent expressions.'){
 const q={id,label,group:label.split('(')[0],maxMarks:marks,sourcePages:pages,statement,fields,
  rubric:{guidance,points:points.map((p,i)=>({id:`p${i+1}`,...(typeof p==='string'?point(p):p)}))}};
 questions.push(q);return q;
}
function table(q,columns,rows){delete q.fields;q.table={columns,rows};return q;}
const textAnswer=[field('answer','Your answer',true)];
table(question('q1a','1(a)',3,[2],`The table has six statements about the Von Neumann model for a computer system. Three of the statements are incorrect.

| Statement number | Statement |
| --- | --- |
| 1 | The Program Counter (PC) stores the next instruction to be fetched from memory. |
| 2 | The Arithmetic and Logic Unit (ALU) performs mathematical and logical operations. |
| 3 | The Control Unit (CU) sends signals to other components on the data bus. |
| 4 | The Memory Data Register (MDR) transfers data to the memory address stored in the Memory Address Register (MAR). |
| 5 | The MAR stores an address from memory. |
| 6 | The Accumulator (ACC) stores the result of calculations. |

Complete the table by writing the three incorrect statement numbers and the corrected statements.`,[],[
 'Statement 1: PC stores the address of the next instruction to be fetched from memory.',
 'Statement 3: CU sends signals to other components on the control bus.',
 'Statement 4: MDR holds data to be stored in, or read from, the memory address in the MAR.'
],'One mark for each correctly identified and corrected row; row order does not matter.'),[
 {id:'number',label:'Incorrect statement number',editable:true},{id:'correction',label:'Corrected statement',editable:true}
],[1,2,3].map(n=>({id:`r${n}`,cells:{}})));
question('q1b','1(b)',2,[3],'Registers that are used in the Fetch-Execute (F-E) cycle include the PC, MAR, MDR and the ACC. Identify one other register and describe its role in the Fetch-Execute (F-E) cycle.',[field('register','Register'),field('role','Role',true)],[
 'Valid other register: Current Instruction Register (CIR), status register (SR), or interrupt register.',
 'Matching role: CIR holds the instruction to be decoded/executed; SR contains individually referenced state/event bits; interrupt register stores details of interrupts.'
],'One mark for a register and one for its corresponding role.');
question('q1c','1(c)',4,[3],'Explain how an interrupt from an input device will be detected and handled in the F-E cycle.',textAnswer,[
 'Interrupt register is checked at the start/end of the F-E cycle.','Priority of waiting interrupts is checked.','Interrupt priority is compared with the current process.','Register contents are saved on the stack.','Relevant interrupt service routine (ISR)/handler is called.','After the ISR, check for higher-priority interrupts.','If no higher-priority interrupts remain, restore registers and continue the next F-E cycle.'
]);
question('q2a','2(a)',2,[4],'Convert the denary integer 558 into 12-bit binary and hexadecimal.',[field('binary','Binary (12 bits)'),field('hex','Hexadecimal')],[point('0010 0010 1110',auto('binary',['001000101110'],'binary')),point('22E',auto('hex',['22E'],'case'))]);
question('q2bi','2(b)(i)',1,[4],'Convert the two’s complement binary integer 11100010 into denary.',[field('answer','Denary integer')],[point('-30',auto('answer',['-30','−30']))]);
question('q2bii','2(b)(ii)',2,[4],'Write the smallest and the largest two’s complement binary integers that can be represented in 8 bits.',[field('smallest','Smallest'),field('largest','Largest')],[point('Smallest: 1000 0000',auto('smallest',['10000000'],'binary')),point('Largest: 0111 1111',auto('largest',['01111111'],'binary'))]);
question('q2c','2(c)',2,[4],'Give one application where Binary Coded Decimal (BCD) is used and justify its use.',[field('application','Application'),field('justification','Justification',true)],[
 'Valid application, e.g. financial/banking calculations, electronic displays, BIOS date/time storage, barcode systems.',
 'Matching justification: decimal financial accuracy without accumulated rounding; displays use individual digits; straightforward decimal/BCD conversion; accurate barcode conversion.'
],'One mark for an application and one for a corresponding justification.');
const ai='A computer program uses a digital camera to read the words on an item. The program can read the words that are written on the item, translate the words to a chosen language and then output the words as audio. For example, when used in a supermarket, the program can output the words written on the labels on products. The program uses Artificial Intelligence (AI).';
question('q3a','3(a)',4,[5],`${ai}\n\nExplain how AI is used in the computer program described.`,textAnswer,[
 'Uses image recognition / optical character recognition.','Analyses photograph pixels to locate characters.','Converts pixel patterns to individual characters.','Uses natural language processing.','Combines characters into words.','Compares words with a database to identify matches in the writing’s language.','May predict missing/incomplete content.','Matches words with a database of the chosen language to translate.','Uses text-to-speech.','Generates audio waveforms corresponding to words.'
]);
question('q3b','3(b)',2,[5],`${ai}\n\nState two social benefits of the use of AI in the computer program described.`,[field('benefit1','Benefit 1',true),field('benefit2','Benefit 2',true)],[
 'Helps visually impaired people identify products to purchase.','Helps people who cannot understand the language.','Helps overcome learning/reading difficulties.'
]);
question('q3ci','3(c)(i)',3,[6],`${ai}\n\nThe computer program is released under a commercial software licence. Describe the features of a commercial software licence.`,textAnswer,[
 'Usually sold for a fee.','Users have no source-code access.','Protects the intellectual rights of the developer.','Users cannot legally alter/share the program.','Use is limited, e.g. number of installations.','Support/maintenance such as updates and bug fixes is usually provided.'
]);
question('q3cii','3(c)(ii)',3,[6],`${ai}\n\nExplain the reasons why an open source software licence might not be appropriate for the computer program described.`,textAnswer,[
 'Accessible source code could be changed.','This might produce incorrect responses.','People might purchase the wrong item.','This could have serious consequences, e.g. allergies.'
]);
question('q4a','4(a)',2,[6],'Write the logic expressions for the following logic circuit.',[field('x','X ='),field('y','Y =')],[
 'X = (R NOR S) XOR T','Y = (T AND U) OR U'
],'One mark for each correct expression. Check equivalent Boolean expressions manually.').images=['logic-circuit'];
table(question('q4b','4(b)',2,[7],'Complete the truth table for the logic expression:\n\nX = NOT (A AND (B XOR C))',[],[
 'First four X values (000, 001, 010, 011) are all 1.','Last four X values (100, 101, 110, 111) are 1, 0, 0, 1.'
],'One mark for each complete group of four correct rows, not one mark per individual row.'),[
 {id:'a',label:'A',editable:false},{id:'b',label:'B',editable:false},{id:'c',label:'C',editable:false},{id:'working',label:'Working space',editable:true},{id:'x',label:'X',editable:true}
],Array.from({length:8},(_,i)=>{const bits=i.toString(2).padStart(3,'0');return {id:`r${i}`,cells:{a:bits[0],b:bits[1],c:bits[2]}};}));
const database=`An online game has a database that stores data about users and the characters each user creates in the game. Each user can create multiple characters and purchase multiple items for each character.

The normalised database has the following design:

\`\`\`text
USER(Username, Password, DateOfBirth)
CHARACTER(CharacterName, CharacterID, Username, Level, Money)
ITEM(ItemName, MinimumLevel, Cost)
CHARACTER_ITEM(CharacterID, ItemName)
\`\`\``;
question('q5a','5(a)',2,[8],`${database}\n\nExplain the purpose of the table CHARACTER_ITEM in the database.`,textAnswer,[
 'Removes the many-to-many relationship.','The relationship is between CHARACTER and ITEM.','Allows each character many items / each item to be bought for many characters.','Creates a linking table.','Links characters with the items purchased for each.'
]);
question('q5b','5(b)',2,[8],`${database}\n\nIdentify the attribute or attributes forming the primary key in each table. On the original paper these are underlined; enter the attribute names below.`,[field('user','USER'),field('character','CHARACTER'),field('item','ITEM'),field('character_item','CHARACTER_ITEM')],[
 'All three single primary keys: USER.Username; CHARACTER.CharacterID; ITEM.ItemName.','Composite key: CHARACTER_ITEM.CharacterID AND ItemName.'
],'One mark for all three single primary keys; one mark for the complete composite key.');
question('q5ci','5(c)(i)',4,[9],`${database}\n\nA Database Management System (DBMS) provides data security. Identify two methods the DBMS can use to protect the data in the table USER from unauthorised access. Explain how each method protects the data.`,[field('method1','Method 1'),field('explanation1','Explanation 1',true),field('method2','Method 2'),field('explanation2','Explanation 2',true)],[
 'First valid method: access rights, password, encryption, or views.','Matching explanation for the first method.','Second distinct valid method.','Matching explanation for the second method.'
],'One mark per method and matching explanation. Access rights require permissions; passwords prevent access without the password; encryption prevents understanding without the decryption key; views can exclude USER data.');
question('q5cii','5(c)(ii)',2,[9],`${database}\n\nThe DBMS also supports data integrity. Give two ways that a DBMS can support data integrity.`,[field('way1','Way 1'),field('way2','Way 2')],[
 'Validation.','Enforcing referential integrity.','Cascade update/delete.','Ensuring the database is normalised.'
]);
question('q5di','5(d)(i)',3,[10],`${database}\n\nWrite a Structured Query Language (SQL) script to count the number of items purchased by the user with the username "KAT123".`,[field('sql','SQL',true)],[
 'SELECT COUNT.','FROM correct tables CHARACTER_ITEM and CHARACTER with a correct join.','WHERE/AND condition selects CHARACTER.Username = "KAT123".'
],'One mark per point. Accept explicit INNER JOIN or equivalent implicit join. Count purchased items across the user’s characters. This is a written SQL answer; it is not executed.');
question('q5dii','5(d)(ii)',3,[10],`${database}\n\nThe following changes need to be made to the character with the ID "0002": level changed to 3; money changed to 10000.00. Write an SQL script to change the character’s data.`,[field('sql','SQL',true)],[
 'UPDATE CHARACTER','SET Level = 3, Money = 10000.00','WHERE CharacterID = "0002"'
],'One mark per point; accept equivalent valid SQL syntax.');
const network='A company has multiple sites in different cities. The company has drivers who deliver products to customers. Each driver can connect to the company’s WAN (Wide Area Network) whilst out of the office using a smartphone.';
question('q6a','6(a)',2,[11],`${network}\n\nState two ways that a WAN is different to a LAN (Local Area Network).`,[field('difference1','Difference 1',true),field('difference2','Difference 2',true)],[
 'WAN covers a larger geographical area; LAN a smaller area.','WAN may use non-dedicated hardware; LAN usually dedicated hardware.','WAN uses external/non-company transmission media; LAN media usually company-owned.'
]);
question('q6b','6(b)',4,[11],`${network}\n\nThe smartphones use the cell phone network to connect to the WAN. Explain how data is transmitted using the cell phone network.`,textAnswer,[
 'Land is split into cells designed for maximum line of sight.','Each cell has a tower/antenna to receive and transmit data.','Data passes between tower and phone.','Wireless transmission uses low-power radio signals/frequencies.','Multiple devices can communicate simultaneously with a tower.'
]);
question('q6c','6(c)',6,[11],`${network}\n\nDevices that connect to the WAN have an IP address. Complete the following description by writing the missing words.

1. IPv4 is displayed as four groups of 8-bit numbers separated by ______. Each IPv4 address is 32 bits.
2. IPv6 is made of eight groups of 4 ______ numbers separated by colons.
3. Multiple consecutive groups of ______ can be replaced with a double colon.
4. Each IPv6 address is ______ bits.
5. A ______ IP address can change each time the computer connects to a network.
6. A ______ IP address can only be accessed by other devices in the same LAN and is assigned by the router within the LAN.`,Array.from({length:6},(_,i)=>field(`blank${i+1}`,`Blank ${i+1}`)),[
 point('full stops',auto('blank1',['full stops','full stop','dots','dot'],'case')),point('hexadecimal',auto('blank2',['hexadecimal','hex'],'case')),point('zeros',auto('blank3',['zeros','zeroes'],'case')),point('128',auto('blank4',['128'])),point('dynamic',auto('blank5',['dynamic'],'case')),point('private',auto('blank6',['private'],'case'))
],'One mark per correct word. Automatic suggestions allow the explicitly listed equivalent forms; teachers make the final decision.');
question('q6d','6(d)',4,[12],`${network}\n\nThe main office for the company has four wired computers, one server, two printers, one central switch and a device providing a single point of access for the internet. The network is set up as a star topology. Draw the topology for the main office network. Label all devices.\n\nUpload a clear image of your labelled drawing.`,[field('description','Optional explanation',true)],[
 'Server directly connected to the switch.','Four labelled computers all directly connected to the switch.','Two printers each connected directly to switch/server/a computer.','Router/modem directly connected to switch/server for internet access.'
],'One mark for each criterion. Judge the uploaded topology, not only a prose description. The official mark scheme includes an example diagram.');
question('q6e','6(e)',3,[12],`${network}\n\nDescribe the role of a switch in a network.`,textAnswer,[
 'Stores MAC addresses of connected devices.','Receives packets from devices.','Forwards packets directly to the intended recipient.','Provides a central connection point.','Enables connected devices to communicate.'
]);
const assembly=`The following table shows part of the instruction set for a processor. The processor has one register: the Accumulator (ACC).

| Instruction | Explanation |
| --- | --- |
| LDD <address> | Direct addressing. Load the contents of the location at the given address to ACC. |
| LDM #n | Immediate addressing. Load the number n to ACC. |
| STO <address> | Store the contents of ACC at the given address. |
| ADD #n/Bn/&n | Add the number to ACC. |
| ADD <address> | Add the contents of the given address to ACC. |
| INC <register> | Add 1 to the contents of the register (ACC). |
| CMP <address> | Compare ACC with contents of <address>. |
| CMP #n | Compare ACC with number n. |
| JPE <address> | Following a compare instruction, jump to <address> if the compare was True. |
| JMP <address> | Jump to the given address. |
| END | Return control to the operating system. |

<address> can be an absolute or symbolic address. # denotes denary, B denotes binary and & denotes hexadecimal.

Current memory contents:

\`\`\`text
10  12
11  11
12  10
13  22
14  22
...
100 LDD 10
101 ADD 12
102 STO 11
103 CMP 14
104 JPE 107
105 INC ACC
106 JMP 101
107 STO 10
108 END
\`\`\``;
table(question('q7ai','7(a)(i)',3,[14,15],`${assembly}\n\nTrace the program currently in memory using the following trace table. The initial values at memory addresses 10–14 are 12, 11, 10, 22, 22. Enter the instruction addresses and changed values; leave unchanged cells empty.`,[],[
 'First shaded section: instruction 100, ACC becomes 12; later instruction addresses 103, 104, 107 are traced; at 107 memory address 10 becomes 22.',
 'Second shaded section: instruction 101, ACC becomes 22.',
 'Third shaded section: instruction 102, memory address 11 becomes 22.'
],'One mark for each complete shaded section in the official mark scheme (page 12). The first shaded section spans non-adjacent rows. Check the original scheme if needed; do not count each filled cell as a mark.'),['instruction','acc','m10','m11','m12','m13','m14'].map((id,i)=>({id,label:['Instruction address','ACC','Memory 10','Memory 11','Memory 12','Memory 13','Memory 14'][i],editable:true})),Array.from({length:8},(_,i)=>({id:`r${i+1}`,cells:{}})));
question('q7aii','7(a)(ii)',1,[14,15],`${assembly}\n\nState the effect of changing instruction LDD 10 in address 100 to LDM #10.`,textAnswer,[
 'Loads literal 10 instead of 12/the contents of address 10, OR addition gives 20 instead of 22 so comparison fails and produces an infinite loop.'
]);
question('q7aiii','7(a)(iii)',2,[14,15],`${assembly}\n\nIdentify and describe one mode of addressing not given in the table of instructions in part (a).`,[field('mode','Mode of addressing'),field('description','Description',true)],[
 'Valid additional mode: indirect, indexed, or relative.','Matching description: indirect operand points to a location containing the data address; indexed adds IX contents to operand; relative calculates address from distance to a base address.'
],'One mark for a mode and one for its matching description.');
const bits='The processor has one register, ACC. AND, XOR and OR perform the corresponding bitwise operation between ACC and the operand. #n is a denary number, Bn a binary number, &n a hexadecimal number; an address operand uses the contents of that address.';
question('q7bi','7(b)(i)',1,[16],`${bits}\n\nACC currently contains 11110000. Write the result after the instruction OR B00001111 is run.`,[field('answer','8-bit result')],[point('1111 1111',auto('answer',['11111111'],'binary'))]);
question('q7bii','7(b)(ii)',1,[16],`${bits}\n\nACC currently contains 00011101. Write the result after the instruction XOR #30 is run.`,[field('answer','8-bit result')],[point('0000 0011',auto('answer',['00000011'],'binary'))]);

export default {format:'campus-written-paper',schemaVersion:1,paper:{slug:'cambridge-9618-2025-summer-12',title:'2025 · May/June · 9618/12',board:'Cambridge',syllabus:'9618',component:1,year:2025,session:'summer',variant:12,syllabusVersion:'2024–2025',maxMarks:75,durationMinutes:90},questions};
