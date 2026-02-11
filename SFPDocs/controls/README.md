# Form Controls Documentation

This directory contains detailed documentation for all Form Controls in SmartFormPlatform.

## Control Hierarchy

```
Control (abstract base)
├── FormControl (abstract - controls with DB column)
│   ├── TextBoxControl
│   ├── TextAreaControl
│   ├── RichTextBoxControl
│   ├── PasswordControl
│   ├── HiddenControl
│   ├── ColorPickerControl
│   ├── CheckBoxControl
│   │   └── SwitchControl
│   ├── DropDownListControl
│   │   ├── RadioButtonListControl
│   │   └── ListBoxControl
│   │       ├── CheckBoxListControl
│   │       └── DualListBoxControl
│   ├── AutoCompleteControl
│   │   └── TagControl
│   └── ...
├── FileControl
│   ├── FileGalleryControl
│   └── FileManagerControl
├── SubFormControl
├── InlineSubFormControl
├── DataGridControl
├── TimeLineControl
├── CommunicationControl
├── CommunicationListControl
└── ... (other non-DB controls)
```

## Control Categories

### Text Input Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| TextBoxControl | Single-line text input | Yes |
| TextAreaControl | Multi-line text input | Yes |
| RichTextBoxControl | WYSIWYG HTML editor | Yes |
| PasswordControl | Password input with hashing | Yes |
| CodeEditorControl | Code editor with syntax highlighting | Yes |

### Selection Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| DropDownListControl | Dropdown select | Yes |
| AutoCompleteControl | Searchable dropdown | Yes |
| CheckBoxControl | Single checkbox | Yes |
| SwitchControl | Toggle switch | Yes |
| RadioButtonListControl | Radio button group | Yes |
| CheckBoxListControl | Multiple checkboxes | No (MultiSelect) |
| ListBoxControl | Multi-select listbox | No (MultiSelect) |
| DualListBoxControl | Two-column list transfer | No (MultiSelect) |
| TagControl | Tag input | No (MultiSelect) |
| TreeSelectBoxControl | Hierarchical tree select | Yes |

### File Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| FileControl | File upload | No (dbo.File) |
| FileGalleryControl | Image gallery | No (dbo.File) |
| FileManagerControl | File manager | No (dbo.File) |
| FillByFileControl | Fill form from file | No |

### Relationship Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| SubFormControl | 1:N sub-form | No |
| InlineSubFormControl | Inline 1:N sub-form | No |
| DataGridControl | Read-only data grid | No |
| FormDialogControl | Modal form dialog | No |

### Display Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| LabelControl | Static label | No |
| AlertControl | Alert message | No |
| HTMLContentControl | Static HTML | No |
| HTMLContentViewControl | Dynamic HTML | No |
| TimeLineControl | History timeline | No |
| GraphControl | Chart/graph | No |
| QRCodeControl | QR code display | No |
| IconControl | Icon picker | Yes |

### Special Controls
| Control | Description | Creates DB Column |
|---------|-------------|-------------------|
| HiddenControl | Hidden field | Yes |
| SignatureControl | Digital signature | No |
| MapDialogControl | Map location picker | Yes |
| CommunicationControl | Comments/discussion | No |
| CommunicationListControl | Communication list | No |
| DocumentApprovalControl | Document approval | No |
| ToDoListControl | Task list | No |
| TimeControl | Time entry | No |
| FilterControl | Embedded filter | No |
| CriteriaControl | Query builder | No |
| FolderTreeControl | Folder tree | No |
| FolderPermissionControl | Folder permissions | No |
| PlaceHolderControl | Dynamic placeholder | No |
| SearchBoxControl | Search input | No |
| LanguageControl | Language selector | Yes |
| EmptyControl | Empty placeholder | No |

## Common Attributes

See [control-base.md](./control-base.md) for attributes inherited by all controls.
