import { AppBar, Toolbar, Typography } from '@mui/material';
import { System } from '@wailsio/runtime';

export const Navbar = () => {
    return (
        <AppBar position='static' enableColorOnDark>
            <Toolbar variant='dense' className={System.IsMac() ? 'pl-21.5' : ''}>
                <Typography variant='subtitle1' fontWeight={500}>
                    MediaSim
                </Typography>
            </Toolbar>
        </AppBar>
    );
};
