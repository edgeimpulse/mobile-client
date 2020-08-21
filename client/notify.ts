import jQuery from "../node_modules/@types/jquery/index";
declare var $: typeof jQuery;
declare var swal: any;

export class Notify {
    /**
     * Show a notification
     * @param title Title
     * @param message Message
     * @param placement Location of the notification item
     * @param align Alignment of the notification item
     * @param icon Which icon to show (e.g. fas fa-bolt)
     * @param type Styling of the notification
     */
    static notify(title: string, message: string, placement: 'top' | 'bottom', align: 'left' | 'center' | 'right',
                  icon: string, type: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'danger') {
        // tslint:disable-next-line: no-unsafe-any
        (<any>$).notify({
            icon: icon,
            title: title,
            message: message,
            url: ''
        }, {
            element: 'body',
            type: type,
            allow_dismiss: true,
            placement: {
                from: placement,
                align: align
            },
            offset: {
                x: 15, // Keep this as default
                y: 15 // Unless there'll be alignment issues as this value is targeted in CSS
            },
            spacing: 10,
            z_index: 1080,
            delay: 2500,
            url_target: '_blank',
            mouse_over: false,
            animate: {
                enter: undefined,
                exit: undefined
            },
            template: '<div data-notify="container" class="alert alert-dismissible alert-{0} alert-notify" role="alert">' +
                '<span class="alert-icon" data-notify="icon"></span> ' +
                '<div class="alert-text"> ' +
                '<span class="alert-title" data-notify="title">{1}</span> ' +
                '<span data-notify="message">{2}</span>' +
                '</div>' +
                // '<div class="progress" data-notify="progressbar">' +
                // '<div class="progress-bar progress-bar-{0}" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width: 0%;"></div>' +
                // '</div>' +
                // '<a href="{3}" target="{4}" data-notify="url"></a>' +
                '<button type="button" class="close" data-notify="dismiss" aria-label="Close"><span aria-hidden="true">&times;</span></button>' +
                '</div>'
        });
    }

    /**
     * Show an alert
     * @param title Alert title
     * @param message Alert message
     * @param type Styling
     * @returns a promise that resolves when the alert closes
     */
    static async alert(title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' | 'question' | 'danger',
                       onBeforeOpen?: (el: HTMLElement) => void):
        Promise<void> {

        let modalType = type === 'danger' ? 'error' : type;

        return new Promise((resolve) => {
            // tslint:disable-next-line: no-unsafe-any
            swal({
                title: title,
                text: message,
                type: modalType,
                buttonsStyling: false,
                confirmButtonClass: 'btn btn-' + type,
                onClose: resolve,
                allowEnterKey: true,
                onBeforeOpen: (el: HTMLElement) => {
                    el.id = 'notify-' + (++this._notifyId);

                    if (onBeforeOpen) {
                        onBeforeOpen(el);
                    }
                }
            });
        });
    }

    /**
     * Show a confirm button
     * @param title Alert title
     * @param message Alert message
     * @param confirmText Text on the confirm button
     * @param type Styling
     * @returns a promise that resolves when the alert closes. Either true or false depending on confirmation.
     */
    static async confirm(title: string, message: string, confirmText: string,
                         modalType: 'success' | 'error' | 'warning' | 'info' | 'question',
                         btnType: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'danger') {
        // tslint:disable-next-line: no-unsafe-any
        let v: { value?: boolean, dismiss?: string } = await swal({
            title: title,
            text: message,
            type: modalType,
            cancelButtonClass: 'btn',
            showCancelButton: true,
            buttonsStyling: false,
            confirmButtonClass: 'btn btn-' + btnType,
            confirmButtonText: confirmText,
            allowEnterKey: true,
            closeOnConfirm: true,
            reverseButtons: true,
            onBeforeOpen: (el: HTMLElement) => {
                el.id = 'notify-' + (++this._notifyId);

                let q = el.querySelector('.swal2-question');
                if (q) {
                    q.classList.add('text-' + btnType);
                    q.classList.add('border-' + btnType);
                }
            }
        });

        if (v.dismiss) {
            return false;
        }

        return true;
    }

    /**
     * Show a prompt box
     * @param title Alert title
     * @param message Alert message
     * @param confirmText Text on the confirm button
     * @param currentValue Default value of the confirm box
     * @param type Styling
     * @returns a promise that resolves when the alert closes. Either false (if dismissed) or a string
     */
    static async prompt(title: string, message: string, confirmText: string, currentValue: string,
                        modalType: 'success' | 'error' | 'warning' | 'info' | 'question',
                        btnType: 'default' | 'primary' | 'info' | 'success' | 'warning' | 'danger') {
        // tslint:disable-next-line: no-unsafe-any
        let v: { value?: string, dismiss?: string } = await swal({
            title: title,
            text: message,
            type: modalType,
            cancelButtonClass: 'btn',
            showCancelButton: true,
            buttonsStyling: false,
            confirmButtonClass: 'btn btn-' + btnType,
            confirmButtonText: confirmText,
            allowEnterKey: true,
            closeOnConfirm: true,
            reverseButtons: true,
            input: 'text',
            inputValue: currentValue,
            onBeforeOpen: (el: HTMLElement) => {
                el.id = 'notify-' + (++this._notifyId);

                let q = el.querySelector('.swal2-question');
                if (q) {
                    q.classList.add('text-' + btnType);
                    q.classList.add('border-' + btnType);
                }
            },
            onOpen: (el: HTMLElement) => {
                let input = el.querySelector('.swal2-input');
                if (input) {
                    (<HTMLInputElement>input).focus();
                    (<HTMLInputElement>input).select();
                }
            }
        });

        if (v.dismiss) {
            return false;
        }

        return v.value || '';
    }

    private static _notifyId = 0;
}
