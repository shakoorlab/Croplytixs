import PropTypes from 'prop-types';

// material-ui
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import InputLabel from '@mui/material/InputLabel';
import FormHelperText from '@mui/material/FormHelperText';

// ==============================|| FORM FIELD ||============================== //

/**
 * Static label above the input, matching the auth forms.
 *
 * MUI's default outlined TextField floats its label into a notch in the top
 * border on focus. This keeps the label put: the input carries no `label` prop,
 * so no notch is cut, and the accessible name comes from `htmlFor` instead.
 * The caller owns the input and must give it the same `id`; when there is helper text,
 * point the input's `aria-describedby` at `${id}-helper` so it is announced with the field.
 */
export default function FormField({ id, label, required = false, error = false, helperText, children, sx }) {
  return (
    <Box sx={sx}>
      <Stack sx={{ gap: 1 }}>
        {/* `htmlFor` names plain inputs; selects render a combobox div that needs
            `aria-labelledby`, so the label also carries a stable id. */}
        <InputLabel id={`${id}-label`} htmlFor={id} required={required} error={error}>
          {label}
        </InputLabel>
        {children}
      </Stack>
      {helperText && (
        <FormHelperText id={`${id}-helper`} error={error} sx={{ mt: 0.75 }}>
          {helperText}
        </FormHelperText>
      )}
    </Box>
  );
}

FormField.propTypes = {
  id: PropTypes.string.isRequired,
  label: PropTypes.node,
  required: PropTypes.bool,
  error: PropTypes.bool,
  helperText: PropTypes.node,
  children: PropTypes.node,
  sx: PropTypes.object
};
