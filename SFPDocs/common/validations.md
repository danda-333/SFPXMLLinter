# Validations Documentation

## Validation Base Class

All validations inherit from abstract `Validation` class.

### Base Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Ident` | string | "" | Validation identifier |
| `ErrorMessage` | string | "" | Error message text |
| `ErrorMessageResourceKey` | string | "" | Error message from translations |

### Usage in Controls

Validations are added to `FormControl` elements in the `Validations` child element:

```xml
<Control xsi:type="TextBoxControl"
         Ident="Email"
         DataType="String"
         TitleResourceKey="Email_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="EmailValidation"
                ErrorMessageResourceKey="InvalidEmail" />
  </Validations>
</Control>
```

---

## Format Validations

### EmailValidation

Validates email format.

**Pattern:** `^([a-zA-Z0-9]{1})+(?:[_\-\.][a-zA-Z0-9]+)*\@([a-zA-Z0-9]{1})+(?:[_\-\.][a-zA-Z0-9]+)*\.([A-Za-z]{2,6})$`

```xml
<Validation xsi:type="EmailValidation"
            ErrorMessageResourceKey="InvalidEmail" />
```

---

### PhoneValidation

Validates phone number format (international format supported).

**Pattern:** `^((\+?[0-9]{2,3})?[0-9]{9})$`

**Valid formats:**
- `123456789`
- `+420123456789`
- `420123456789`

```xml
<Validation xsi:type="PhoneValidation"
            ErrorMessageResourceKey="InvalidPhone" />
```

---

### RegularExpressionValidation

Custom regex validation.

#### Specific Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Expression` | string | **Required.** Regular expression pattern |

#### Examples

**Postal code (Czech format):**
```xml
<Validation xsi:type="RegularExpressionValidation"
            Expression="^[0-9]{3}\s?[0-9]{2}$"
            ErrorMessageResourceKey="InvalidPostalCode" />
```

**URL validation:**
```xml
<Validation xsi:type="RegularExpressionValidation"
            Expression="^https?://[^\s]+$"
            ErrorMessageResourceKey="InvalidUrl" />
```

**Custom pattern:**
```xml
<Validation xsi:type="RegularExpressionValidation"
            Expression="^[A-Z]{2}[0-9]{6}$"
            ErrorMessageResourceKey="InvalidCode" />
```

---

### BirthNumberValidation

Validates Czech/Slovak birth number (rodné číslo) with checksum verification.

#### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `AllowedSeparators` | string | " /" | Allowed separator characters between parts |
| `IsRequireSeparator` | bool | false | Require separator (space or slash) |

#### Validation Rules
- 9-digit format for birth dates before 1954
- 10-digit format for birth dates from 1954 onwards
- Checksum verification for 10-digit numbers
- Month validation (including +50 for women, +20/+70 for special cases after 2003)

#### Examples

**Basic:**
```xml
<Validation xsi:type="BirthNumberValidation"
            ErrorMessageResourceKey="InvalidBirthNumber" />
```

**With required separator:**
```xml
<Validation xsi:type="BirthNumberValidation"
            IsRequireSeparator="true"
            AllowedSeparators="/"
            ErrorMessageResourceKey="InvalidBirthNumber" />
```

---

## Number Validations

### NumberValidation

Validates integer number format.

**Pattern:** `^([-]?\d+)$`

```xml
<Validation xsi:type="NumberValidation"
            ErrorMessageResourceKey="InvalidNumber" />
```

---

### DoubleValidation

Validates decimal number format with configurable decimal places.

#### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `Digits` | int | 2 | Maximum decimal places allowed |

#### Examples

**Default (2 decimal places):**
```xml
<Validation xsi:type="DoubleValidation"
            ErrorMessageResourceKey="InvalidDecimal" />
```

**4 decimal places:**
```xml
<Validation xsi:type="DoubleValidation"
            Digits="4"
            ErrorMessageResourceKey="InvalidDecimal" />
```

---

### RangeNumberValidation

Validates that a number is within specified range.

#### Specific Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `Min` | int | **Required.** Minimum value (inclusive) |
| `Max` | int | **Required.** Maximum value (inclusive) |

#### Examples

**Age validation (0-150):**
```xml
<Validation xsi:type="RangeNumberValidation"
            Min="0"
            Max="150"
            ErrorMessageResourceKey="InvalidAge" />
```

**Percentage (0-100):**
```xml
<Validation xsi:type="RangeNumberValidation"
            Min="0"
            Max="100"
            ErrorMessageResourceKey="InvalidPercentage" />
```

**Quantity (1-9999):**
```xml
<Validation xsi:type="RangeNumberValidation"
            Min="1"
            Max="9999"
            ErrorMessageResourceKey="InvalidQuantity" />
```

---

### NumberOverflowValidation

Validates that number doesn't exceed SQL int limits.

```xml
<Validation xsi:type="NumberOverflowValidation"
            ErrorMessageResourceKey="NumberTooLarge" />
```

---

### DoubleOverflowValidation

Validates that decimal number doesn't exceed SQL float limits.

```xml
<Validation xsi:type="DoubleOverflowValidation"
            ErrorMessageResourceKey="NumberTooLarge" />
```

---

## Date/Time Validations

### DateValidation

Validates date format.

```xml
<Validation xsi:type="DateValidation"
            ErrorMessageResourceKey="InvalidDate" />
```

---

### DateTimeValidation

Validates date and time format.

```xml
<Validation xsi:type="DateTimeValidation"
            ErrorMessageResourceKey="InvalidDateTime" />
```

---

### TimeValidation

Validates time format (HH:mm or HH:mm:ss).

**Pattern:** `^([0-1]?[0-9]|[2][0-3]):([0-5]?[0-9])(:[0-5][0-9])?$`

**Valid formats:**
- `9:30`
- `09:30`
- `23:59`
- `09:30:45`

```xml
<Validation xsi:type="TimeValidation"
            ErrorMessageResourceKey="InvalidTime" />
```

---

### DateTimePastValidation

Validates that date/time is not in the past (with optional offset).

#### Specific Attributes

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `AddDays` | int | 0 | Days to add to current date for comparison |

#### Examples

**Not in past:**
```xml
<Validation xsi:type="DateTimePastValidation"
            ErrorMessageResourceKey="DateCannotBeInPast" />
```

**At least 7 days in future:**
```xml
<Validation xsi:type="DateTimePastValidation"
            AddDays="7"
            ErrorMessageResourceKey="DateMustBe7DaysAhead" />
```

**Allow yesterday (AddDays=-1):**
```xml
<Validation xsi:type="DateTimePastValidation"
            AddDays="-1"
            ErrorMessageResourceKey="DateTooOld" />
```

---

## Comparison Validations

### CompareValidation

Validates that value matches another control's value.

#### Specific Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `SecondControlIdent` | string | **Required.** Ident of control to compare with |

#### Examples

**Password confirmation:**
```xml
<Control xsi:type="PasswordBoxControl"
         Ident="Password"
         TitleResourceKey="Password_Form"
         IsRequired="true" />

<Control xsi:type="PasswordBoxControl"
         Ident="PasswordConfirm"
         TitleResourceKey="PasswordConfirm_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="CompareValidation"
                SecondControlIdent="Password"
                ErrorMessageResourceKey="PasswordsDoNotMatch" />
  </Validations>
</Control>
```

**Email confirmation:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="EmailConfirm"
         DataType="String"
         TitleResourceKey="EmailConfirm_Form">
  <Validations>
    <Validation xsi:type="CompareValidation"
                SecondControlIdent="Email"
                ErrorMessageResourceKey="EmailsDoNotMatch" />
  </Validations>
</Control>
```

---

## Conditional Validations

### RequiredIfValidation

Makes field required when other specified fields have values.

#### Child Elements

| Element | Type | Description |
|---------|------|-------------|
| `RequiredControls` | List&lt;string&gt; | Control idents that trigger requirement |

#### Examples

**Required if address is filled:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="City"
         DataType="String"
         TitleResourceKey="City_Form">
  <Validations>
    <Validation xsi:type="RequiredIfValidation"
                ErrorMessageResourceKey="CityRequiredIfAddress">
      <RequiredControls>
        <string>Street</string>
      </RequiredControls>
    </Validation>
  </Validations>
</Control>
```

**Required if multiple fields filled:**
```xml
<Control xsi:type="TextBoxControl"
         Ident="PostalCode"
         DataType="String"
         TitleResourceKey="PostalCode_Form">
  <Validations>
    <Validation xsi:type="RequiredIfValidation"
                ErrorMessageResourceKey="PostalCodeRequired">
      <RequiredControls>
        <string>Street</string>
        <string>City</string>
      </RequiredControls>
    </Validation>
  </Validations>
</Control>
```

---

### RequiredTrueValidation

Validates that checkbox/boolean field is checked/true.

```xml
<Control xsi:type="CheckBoxControl"
         Ident="AcceptTerms"
         TitleResourceKey="AcceptTerms_Form">
  <Validations>
    <Validation xsi:type="RequiredTrueValidation"
                ErrorMessageResourceKey="MustAcceptTerms" />
  </Validations>
</Control>
```

---

## Special Validations

### MaxEmbedImageSizeValidation

Validates maximum embedded image size in RichTextBox content.

```xml
<Control xsi:type="RichTextBoxControl"
         Ident="Description"
         TitleResourceKey="Description_Form">
  <Validations>
    <Validation xsi:type="MaxEmbedImageSizeValidation"
                ErrorMessageResourceKey="ImageTooLarge" />
  </Validations>
</Control>
```

---

### CommunicationFormExtensionValidation

Validation for CommunicationControl form extensions.

```xml
<Validation xsi:type="CommunicationFormExtensionValidation"
            ErrorMessageResourceKey="InvalidCommunication" />
```

---

## Multiple Validations

Controls can have multiple validations:

```xml
<Control xsi:type="TextBoxControl"
         Ident="PhoneNumber"
         DataType="String"
         TitleResourceKey="Phone_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="PhoneValidation"
                ErrorMessageResourceKey="InvalidPhoneFormat" />
    <Validation xsi:type="RegularExpressionValidation"
                Expression="^\+420"
                ErrorMessageResourceKey="PhoneMustStartWith420" />
  </Validations>
</Control>
```

---

## Common Validation Patterns

### Required + Format

```xml
<Control xsi:type="TextBoxControl"
         Ident="Email"
         DataType="String"
         TitleResourceKey="Email_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="EmailValidation"
                ErrorMessageResourceKey="InvalidEmail" />
  </Validations>
</Control>
```

### Number with Range

```xml
<Control xsi:type="TextBoxControl"
         Ident="Age"
         DataType="Number"
         TitleResourceKey="Age_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="NumberValidation"
                ErrorMessageResourceKey="MustBeNumber" />
    <Validation xsi:type="RangeNumberValidation"
                Min="0" Max="150"
                ErrorMessageResourceKey="InvalidAge" />
  </Validations>
</Control>
```

### Decimal Amount

```xml
<Control xsi:type="TextBoxControl"
         Ident="Price"
         DataType="Money"
         TitleResourceKey="Price_Form">
  <Validations>
    <Validation xsi:type="DoubleValidation"
                Digits="2"
                ErrorMessageResourceKey="InvalidPrice" />
    <Validation xsi:type="RangeNumberValidation"
                Min="0" Max="999999"
                ErrorMessageResourceKey="PriceOutOfRange" />
  </Validations>
</Control>
```

### Date in Future

```xml
<Control xsi:type="DateTimeControl"
         Ident="DueDate"
         TitleResourceKey="DueDate_Form"
         IsRequired="true">
  <Validations>
    <Validation xsi:type="DateValidation"
                ErrorMessageResourceKey="InvalidDate" />
    <Validation xsi:type="DateTimePastValidation"
                AddDays="1"
                ErrorMessageResourceKey="DueDateMustBeFuture" />
  </Validations>
</Control>
```

---

## Validation Inheritance Summary

```
Validation (abstract)
├── EmailValidation
├── PhoneValidation
├── RegularExpressionValidation
├── BirthNumberValidation
├── NumberValidation
├── DoubleValidation
├── RangeNumberValidation
├── NumberOverflowValidation
├── DoubleOverflowValidation
├── DateValidation
├── DateTimeValidation
├── TimeValidation
├── DateTimePastValidation
├── CompareValidation
├── RequiredIfValidation
├── RequiredTrueValidation
├── MaxEmbedImageSizeValidation
└── CommunicationFormExtensionValidation
```
